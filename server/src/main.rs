use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    http::{HeaderValue, Method},
    middleware,
    routing::{delete, get, patch, post, put},
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

mod auth;
mod config;
mod db;
mod feed;
mod near;
mod reputation;
mod routes;
mod validation;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nearfm_server=debug,tower_http=debug".into()),
        )
        .init();

    let config = config::Config::from_env();
    tracing::info!(
        "Starting near.fm server (network: {}, contract: {})",
        config.near_network,
        config.contract_id
    );

    // Database
    let db = sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&db).await?;
    tracing::info!("Database migrations applied");

    // Start background jobs
    tokio::spawn(feed::start_feed_scoring_loop(db.clone()));
    tokio::spawn(reputation::start_reputation_loop(db.clone()));

    let state = AppState {
        db,
        config: Arc::new(config.clone()),
    };

    // CORS
    let cors = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ])
        .allow_credentials(true)
        .allow_origin(
            config
                .cors_origins
                .iter()
                .filter_map(|o| o.parse::<HeaderValue>().ok())
                .collect::<Vec<_>>(),
        );

    // All routes in a single router — auth middleware is pass-through
    // (handlers call require_auth/require_admin to enforce authentication)
    let app = Router::new()
        // Songs
        .route("/api/songs", get(routes::songs::list_songs).post(routes::songs::create_song))
        .route("/api/songs/:uuid", get(routes::songs::get_song).put(routes::songs::update_song))
        .route("/api/songs/:uuid/play", post(routes::songs::increment_play))
        .route("/api/songs/:uuid/vote", get(routes::songs::get_vote).post(routes::songs::vote_song))
        .route("/api/songs/:uuid/report", post(routes::songs::report_song))
        // Requests
        .route("/api/requests", get(routes::requests::list_requests).post(routes::requests::create_request))
        .route("/api/requests/:uuid", get(routes::requests::get_request).patch(routes::requests::update_request))
        .route("/api/requests/:uuid/submissions", post(routes::requests::submit_to_request))
        // Tips
        .route("/api/tips", post(routes::tips::record_tip))
        // Users
        .route("/api/users/:account_id", get(routes::users::get_profile))
        .route(
            "/api/users/:account_id/bookmarks",
            get(routes::users::list_bookmarks).post(routes::users::add_bookmark),
        )
        .route(
            "/api/users/:account_id/bookmarks/:song_uuid",
            delete(routes::users::remove_bookmark),
        )
        // Notifications
        .route(
            "/api/notifications",
            get(|state: axum::extract::State<AppState>, extensions: axum::http::Extensions| async move {
                let claims = auth::jwt::require_auth(&extensions)
                    .map_err(|s| (s, "Authentication required".to_string()))?;
                let notifications = sqlx::query_as::<_, db::models::Notification>(
                    "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
                )
                .bind(claims.user_id)
                .fetch_all(&state.db)
                .await
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                Ok::<_, (axum::http::StatusCode, String)>(axum::Json(notifications))
            }),
        )
        .route(
            "/api/notifications/read-all",
            post(|state: axum::extract::State<AppState>, extensions: axum::http::Extensions| async move {
                let claims = auth::jwt::require_auth(&extensions)
                    .map_err(|s| (s, "Authentication required".to_string()))?;
                sqlx::query("UPDATE notifications SET is_read = TRUE WHERE user_id = $1")
                    .bind(claims.user_id)
                    .execute(&state.db)
                    .await
                    .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                Ok::<_, (axum::http::StatusCode, String)>(axum::http::StatusCode::OK)
            }),
        )
        // Auth
        .route("/api/auth/verify", post(routes::auth::verify))
        // Admin
        .route("/api/admin/categories", post(routes::admin::create_category))
        .route("/api/admin/categories/:id", delete(routes::admin::delete_category))
        .route("/api/admin/reports", get(routes::admin::list_reports))
        .route("/api/admin/reports/:id", patch(routes::admin::review_report))
        .route(
            "/api/admin/songs/:uuid",
            patch(routes::admin::moderate_song).delete(routes::admin::delete_song),
        )
        .route("/api/admin/config", get(routes::admin::get_config).patch(routes::admin::update_config))
        .route(
            "/api/categories",
            get(routes::admin::list_categories),
        )
        .route(
            "/api/languages",
            get(|state: axum::extract::State<AppState>| async move {
                let langs = db::queries::list_languages(&state.db).await.unwrap_or_default();
                axum::Json(langs)
            }),
        )
        // Global middleware
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::jwt::auth_middleware,
        ))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024)) // 10MB
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("Listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
