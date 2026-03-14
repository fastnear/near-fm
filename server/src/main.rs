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
mod rate_limit;
mod reputation;
mod routes;
mod validation;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: Arc<config::Config>,
    pub http_client: reqwest::Client,
    pub suno_client: reqwest::Client,
    pub suno_cache: routes::suno::SunoTaskCache,
    pub suno_lyrics_cache: Arc<tokio::sync::RwLock<std::collections::HashMap<String, routes::suno::SunoLyricsCallbackData>>>,
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
    tokio::spawn(validation::revalidate_pending(db.clone()));

    let suno_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 min for Suno generation
        .build()?;

    let state = AppState {
        db,
        config: Arc::new(config.clone()),
        http_client: reqwest::Client::new(),
        suno_client,
        suno_cache: routes::suno::new_task_cache(),
        suno_lyrics_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
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

    // Rate limiters
    let strict_limiter = rate_limit::strict();
    let moderate_limiter = rate_limit::moderate();

    // Strict rate-limited routes (5 req/min per IP) — RPC calls / financial writes
    let strict_routes = Router::new()
        .route("/api/tips", post(routes::tips::record_tip))
        .route("/api/songs/:uuid/comments", post(routes::comments::create_comment))
        .route("/api/comments/:id", delete(routes::comments::delete_comment))
        .route("/api/requests/:uuid", patch(routes::requests::update_request))
        .layer(middleware::from_fn_with_state(
            strict_limiter,
            rate_limit::rate_limit_middleware,
        ));

    // Moderate rate-limited routes (30 req/min per IP) — auth / writes
    let moderate_routes = Router::new()
        .route("/api/auth/verify", post(routes::auth::verify))
        .route("/api/auth/link-wallet", post(routes::auth::link_wallet))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/songs", post(routes::songs::create_song))
        .route("/api/requests", post(routes::requests::create_request))
        .route("/api/songs/:uuid/vote", post(routes::songs::vote_song))
        .route("/api/songs/:uuid/diamond-like", post(routes::songs::diamond_like_song))
        .route("/api/songs/:uuid/report", post(routes::songs::report_song))
        .route("/api/playlists", post(routes::playlists::create_playlist))
        .route("/api/playlists/:uuid", patch(routes::playlists::update_playlist).delete(routes::playlists::delete_playlist))
        .route("/api/playlists/:uuid/songs", post(routes::playlists::add_song_to_playlist))
        .route("/api/playlists/:uuid/songs/:song_uuid", delete(routes::playlists::remove_song_from_playlist))
        .route("/api/playlists/:uuid/reorder", put(routes::playlists::reorder_playlist_songs))
        .route("/api/suno/generate", post(routes::suno::generate))
        .route("/api/suno/generate-lyrics", post(routes::suno::generate_lyrics))
        .route("/api/credits/topup", post(routes::credits::topup))
        .route("/api/auth/agent", post(routes::auth::agent_auth))
        .layer(middleware::from_fn_with_state(
            moderate_limiter,
            rate_limit::rate_limit_middleware,
        ));

    // All routes — auth middleware is pass-through
    // (handlers call require_auth/require_admin to enforce authentication)
    let app = Router::new()
        // Merge rate-limited routes
        .merge(strict_routes)
        .merge(moderate_routes)
        // Public stats
        .route(
            "/api/stats",
            get(|state: axum::extract::State<AppState>| async move {
                let row: (i64, i64, String, String) = sqlx::query_as(
                    r#"SELECT
                        (SELECT COUNT(*) FROM songs WHERE NOT is_deleted AND NOT is_hidden) AS total_songs,
                        (SELECT COALESCE(SUM(play_count), 0) FROM songs WHERE NOT is_deleted AND NOT is_hidden) AS total_plays,
                        (SELECT COALESCE(SUM(CAST(total_tips_yocto AS NUMERIC)), 0)::TEXT FROM songs WHERE NOT is_deleted AND NOT is_hidden) AS total_tips_yocto,
                        (SELECT COALESCE(SUM(CAST(bounty_amount_yocto AS NUMERIC)), 0)::TEXT FROM song_requests) AS total_bounties_yocto
                    "#,
                )
                .fetch_one(&state.db)
                .await
                .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                Ok::<_, (axum::http::StatusCode, String)>(axum::Json(serde_json::json!({
                    "total_songs": row.0,
                    "total_plays": row.1,
                    "total_tips_yocto": row.2,
                    "total_bounties_yocto": row.3,
                })))
            }),
        )
        // Google OAuth
        .route("/api/auth/google", get(routes::auth::google_redirect))
        .route("/api/auth/google/callback", get(routes::auth::google_callback))
        .route("/api/auth/me", get(routes::auth::get_me))
        // Songs (GET + PUT not rate-limited)
        .route("/api/songs", get(routes::songs::list_songs))
        .route("/api/songs/:uuid", get(routes::songs::get_song).put(routes::songs::update_song))
        .route("/api/songs/:uuid/play", post(routes::songs::increment_play))
        .route("/api/songs/:uuid/my-stats", get(routes::songs::get_song_my_stats))
        .route("/api/songs/:uuid/vote", get(routes::songs::get_vote))
        .route("/api/songs/:uuid/diamond-likers", get(routes::songs::get_diamond_likers))
        .route("/api/me/diamond-likes-remaining", get(routes::songs::get_diamond_likes_remaining))
        .route("/api/radio", get(routes::songs::get_radio))
        .route("/api/radio/skip", post(routes::songs::radio_skip))
        // Requests (GET not rate-limited)
        .route("/api/requests", get(routes::requests::list_requests))
        .route("/api/requests/:uuid", get(routes::requests::get_request))
        .route("/api/requests/:uuid/submissions", get(routes::requests::list_submissions).post(routes::requests::submit_to_request))
        // Comments (GET not rate-limited)
        .route("/api/songs/:uuid/comments", get(routes::comments::list_comments))
        // Users
        .route("/api/users/:account_id", get(routes::users::get_profile))
        .route("/api/users/:account_id/profile", patch(routes::users::update_profile))
        // Deprecated: bookmarks feature removed from UI
        // .route(
        //     "/api/users/:account_id/bookmarks",
        //     get(routes::users::list_bookmarks).post(routes::users::add_bookmark),
        // )
        // .route(
        //     "/api/users/:account_id/bookmarks/:song_uuid",
        //     delete(routes::users::remove_bookmark),
        // )
        .route(
            "/api/users/:account_id/follow",
            post(routes::users::follow_user).delete(routes::users::unfollow_user),
        )
        .route(
            "/api/users/:account_id/follow-status",
            get(routes::users::get_follow_status),
        )
        .route(
            "/api/users/:account_id/followers",
            get(routes::users::list_followers),
        )
        .route(
            "/api/users/:account_id/feed-preferences",
            get(routes::users::get_feed_preferences).put(routes::users::update_feed_preferences),
        )
        .route(
            "/api/users/:account_id/block",
            post(routes::users::block_user).delete(routes::users::unblock_user),
        )
        .route(
            "/api/users/:account_id/blocked",
            get(routes::users::list_blocked_users),
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
        // Admin
        .route("/api/admin/categories", post(routes::admin::create_category))
        .route("/api/admin/categories/:id", delete(routes::admin::delete_category))
        .route("/api/admin/reports", get(routes::admin::list_reports))
        .route("/api/admin/reports/:id", patch(routes::admin::review_report))
        .route("/api/admin/songs/scores", get(routes::admin::list_song_scores))
        .route(
            "/api/admin/songs/:uuid",
            patch(routes::admin::moderate_song).delete(routes::admin::delete_song),
        )
        .route("/api/admin/requests", get(routes::admin::list_requests))
        .route("/api/admin/requests/:uuid", patch(routes::admin::moderate_request))
        .route("/api/admin/comments", get(routes::comments::admin_list_comments))
        .route("/api/admin/comments/:id", patch(routes::comments::admin_moderate_comment))
        .route("/api/admin/users", get(routes::admin::admin_list_users))
        .route("/api/admin/users/:account_id/mute", patch(routes::comments::admin_toggle_mute))
        .route("/api/admin/users/:account_id/ban", patch(routes::admin::admin_toggle_ban))
        .route("/api/admin/config", get(routes::admin::get_config).patch(routes::admin::update_config))
        .route("/api/genres", get(routes::admin::list_genres))
        .route("/api/admin/genres", post(routes::admin::create_genre))
        .route("/api/admin/genres/:id", delete(routes::admin::delete_genre))
        .route(
            "/api/categories",
            get(routes::admin::list_categories),
        )
        // Playlists (reads)
        .route("/api/playlists", get(routes::playlists::list_playlists))
        .route("/api/playlists/:uuid", get(routes::playlists::get_playlist))
        .route("/api/playlists/:uuid/songs", get(routes::playlists::list_playlist_songs))
        // RSS feed
        .route("/feed/:feed_token", get(routes::rss::playlist_feed))
        // Credits
        .route("/api/credits/balance", get(routes::credits::balance))
        .route("/api/credits/history", get(routes::credits::history))
        .route("/api/credits/usage", get(routes::credits::usage))
        .route("/api/credits/pricing", get(routes::credits::pricing))
        // Suno AI
        .route("/api/suno/status", get(routes::suno::status))
        .route("/api/suno/credits", get(routes::suno::credits))
        .route("/api/suno/callback", post(routes::suno::callback))
        .route("/api/suno/download", get(routes::suno::download))
        .route("/api/suno/lyrics-status", get(routes::suno::lyrics_status))
        .route("/api/suno/lyrics-callback", post(routes::suno::lyrics_callback))
        .route("/api/languages", get(routes::admin::list_languages))
        .route("/api/admin/languages", post(routes::admin::create_language))
        .route("/api/admin/languages/:id", delete(routes::admin::delete_language))
        .route("/api/admin/credits/summary", get(routes::admin::credits_summary))
        .route("/api/admin/credits/transactions", get(routes::admin::credits_transactions))
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
