use axum::{
    extract::{Query, State},
    http::{header, Extensions, HeaderMap, StatusCode},
    response::{IntoResponse, Redirect},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::{self, require_auth},
    auth::nep413,
    db::queries,
    AppState,
};

/// Build session cookie with appropriate flags for the environment.
/// In production (near.fm), sets Domain and Secure. In dev, omits them.
pub fn build_session_cookie(token: &str, frontend_url: &str) -> String {
    let is_prod = frontend_url.contains("near.fm");
    if is_prod {
        format!(
            "nearfm_session={}; Domain=.near.fm; Path=/; SameSite=Lax; Secure; Max-Age=31536000",
            token
        )
    } else {
        format!(
            "nearfm_session={}; Path=/; SameSite=Lax; Max-Age=31536000",
            token
        )
    }
}

#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    pub account_id: String,
    pub public_key: String,
    pub signature: String,
    pub message: String,
    pub nonce: Vec<u8>,
    pub recipient: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: i32,
    pub account_id: String, // slug for backward compat
    pub slug: String,
    pub display_name: Option<String>,
    pub is_admin: bool,
    pub is_premium: bool,
    pub premium_until: Option<String>,
    pub reputation_score: String,
    pub auth_provider: String,
    pub near_account_id: Option<String>,
}

fn compute_premium(user: &crate::db::models::User) -> (bool, Option<String>) {
    let is_premium = user.premium_until.map_or(false, |u| u > chrono::Utc::now());
    let premium_until = user.premium_until.map(|u| u.to_rfc3339());
    (is_premium, premium_until)
}

pub async fn verify(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // 0. Parse and validate JSON message
    let msg: serde_json::Value = serde_json::from_str(&req.message).map_err(|_| {
        (StatusCode::BAD_REQUEST, "Message must be JSON".to_string())
    })?;

    if msg.get("action").and_then(|v| v.as_str()) != Some("sign_in")
        || msg.get("domain").and_then(|v| v.as_str()) != Some("near.fm")
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid message format".to_string()));
    }

    // Version check — only accept v1+
    let version = msg.get("version").and_then(|v| v.as_u64()).unwrap_or(1);
    if version < 1 {
        return Err((StatusCode::BAD_REQUEST, "Unsupported message version".to_string()));
    }

    // Validate timestamp
    let ts = msg.get("timestamp").and_then(|v| v.as_i64()).ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "Missing timestamp".to_string())
    })?;
    let now = chrono::Utc::now().timestamp_millis();
    let age_ms = now - ts;
    if age_ms > 5 * 60 * 1000 || age_ms < -30_000 {
        return Err((StatusCode::BAD_REQUEST, "Signature expired".to_string()));
    }

    // 1. Verify NEP-413 signature
    let valid = nep413::verify_nep413_signature(
        &req.public_key,
        &req.signature,
        &req.message,
        &req.nonce,
        &req.recipient,
    )
    .map_err(|e| (StatusCode::BAD_REQUEST, format!("Signature error: {}", e)))?;

    if !valid {
        return Err((StatusCode::UNAUTHORIZED, "Invalid signature".to_string()));
    }

    // 2. Verify public key belongs to account via NEAR RPC
    let key_valid = nep413::verify_access_key(
        &state.config.near_rpc_url,
        &req.account_id,
        &req.public_key,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    if !key_valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Public key does not belong to account".to_string(),
        ));
    }

    // 3. Get or create user
    let is_admin = state.config.is_admin(&req.account_id);
    let user = queries::get_or_create_user(&state.db, &req.account_id, is_admin)
        .await
        .map_err(|e| {
            tracing::error!("get_or_create_user failed for {}: {:?}", &req.account_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {}", e),
            )
        })?;

    // 4. Create JWT
    let token = jwt::create_token(
        &state.config.jwt_secret,
        &user.slug,
        user.id,
        user.is_admin,
        user.account_id.as_deref(),
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Token error: {}", e),
        )
    })?;

    let cookie = build_session_cookie(&token, &state.config.frontend_url);

    let (is_premium, premium_until) = compute_premium(&user);

    let body = Json(VerifyResponse {
        token,
        user: UserResponse {
            id: user.id,
            account_id: user.slug.clone(),
            slug: user.slug,
            display_name: user.display_name,
            is_admin: user.is_admin,
            is_premium,
            premium_until,
            reputation_score: user.reputation_score.to_string(),
            auth_provider: user.auth_provider,
            near_account_id: user.account_id,
        },
    });

    Ok(([(header::SET_COOKIE, cookie)], body))
}

// ── Google OAuth ──

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct GoogleCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// GET /api/auth/google — redirect to Google consent screen
pub async fn google_redirect(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if state.config.google_client_id.is_empty() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Google login is not configured".to_string()));
    }

    // Generate random state for CSRF protection
    let csrf_state = uuid::Uuid::new_v4().to_string();

    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=openid%20email%20profile&state={}&access_type=online&prompt=select_account",
        urlencoding::encode(&state.config.google_client_id),
        urlencoding::encode(&state.config.google_redirect_uri),
        urlencoding::encode(&csrf_state),
    );

    // Store state in HttpOnly cookie for verification in callback
    let is_prod = state.config.frontend_url.contains("near.fm");
    let state_cookie = if is_prod {
        format!(
            "oauth_state={}; Domain=.near.fm; Path=/; SameSite=Lax; Secure; HttpOnly; Max-Age=600",
            csrf_state
        )
    } else {
        format!(
            "oauth_state={}; Path=/; SameSite=Lax; HttpOnly; Max-Age=600",
            csrf_state
        )
    };

    Ok((
        [(header::SET_COOKIE, state_cookie), (header::LOCATION, url)],
        StatusCode::TEMPORARY_REDIRECT,
    ))
}

/// GET /api/auth/google/callback — handle OAuth callback
pub async fn google_callback(
    State(state): State<AppState>,
    Query(params): Query<GoogleCallbackQuery>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if let Some(ref err) = params.error {
        tracing::warn!("Google OAuth error: {}", err);
        return Ok(Redirect::temporary(&state.config.frontend_url).into_response());
    }

    // Verify CSRF state
    let expected_state = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';')
                .find_map(|c| {
                    let c = c.trim();
                    c.strip_prefix("oauth_state=").map(|s| s.to_string())
                })
        });

    if let Some(ref received_state) = params.state {
        if expected_state.as_deref() != Some(received_state.as_str()) {
            tracing::warn!("CSRF state mismatch");
            return Err((StatusCode::BAD_REQUEST, "Invalid state parameter".to_string()));
        }
    } else {
        return Err((StatusCode::BAD_REQUEST, "Missing state parameter".to_string()));
    }

    let code = params.code.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "Missing authorization code".to_string())
    })?;

    // Exchange code for tokens
    let client = reqwest::Client::new();
    let token_response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.as_str()),
            ("client_id", &state.config.google_client_id),
            ("client_secret", &state.config.google_client_secret),
            ("redirect_uri", &state.config.google_redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Token exchange failed: {}", e)))?;

    if !token_response.status().is_success() {
        let text = token_response.text().await.unwrap_or_default();
        tracing::error!("Google token exchange failed: {}", text);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "Google token exchange failed".to_string()));
    }

    let token_data: serde_json::Value = token_response
        .json()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Token parse error: {}", e)))?;

    let id_token = token_data["id_token"]
        .as_str()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Missing id_token".to_string()))?;

    // Decode id_token payload (no verification needed — received directly from Google over HTTPS)
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "Invalid id_token format".to_string()));
    }

    let payload_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        parts[1],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Base64 decode error: {}", e)))?;

    let payload: serde_json::Value = serde_json::from_slice(&payload_bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("JSON parse error: {}", e)))?;

    let google_sub = payload["sub"]
        .as_str()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Missing sub in id_token".to_string()))?;
    let email = payload["email"].as_str().unwrap_or("");
    let name = payload["name"].as_str().unwrap_or("User");
    let picture = payload["picture"].as_str();

    // Find or create user
    let user = if let Some(existing) = queries::get_user_by_google_id(&state.db, google_sub)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        // Update avatar and display name from Google on each login
        sqlx::query(
            "UPDATE users SET avatar_url = COALESCE($1, avatar_url), display_name = COALESCE($2, display_name), updated_at = NOW() WHERE id = $3"
        )
        .bind(picture)
        .bind(name)
        .bind(existing.id)
        .execute(&state.db)
        .await
        .ok();

        existing
    } else {
        // Retry with different slugs in case of unique constraint collision
        let mut user_result = None;
        for _ in 0..5 {
            let slug = generate_slug(name);
            match queries::create_google_user(&state.db, google_sub, email, name, picture, &slug).await {
                Ok(u) => { user_result = Some(u); break; }
                Err(e) => {
                    let err_str = e.to_string();
                    if err_str.contains("unique") || err_str.contains("duplicate") {
                        continue; // Slug collision, retry
                    }
                    tracing::error!("create_google_user failed: {:?}", e);
                    return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)));
                }
            }
        }
        user_result.ok_or_else(|| {
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to generate unique slug".to_string())
        })?
    };

    // Create JWT
    let token = jwt::create_token(
        &state.config.jwt_secret,
        &user.slug,
        user.id,
        user.is_admin,
        user.account_id.as_deref(),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Token error: {}", e)))?;

    let cookie = build_session_cookie(&token, &state.config.frontend_url);

    // Build response with session cookie + clear oauth_state cookie + redirect
    let response = axum::response::Response::builder()
        .status(StatusCode::TEMPORARY_REDIRECT)
        .header(header::LOCATION, &state.config.frontend_url)
        .header(header::SET_COOKIE, cookie)
        .header(header::SET_COOKIE, "oauth_state=; Path=/; Max-Age=0")
        .body(axum::body::Body::empty())
        .unwrap();

    Ok(response.into_response())
}

const RESERVED_SLUGS: &[&str] = &[
    "admin", "support", "moderator", "system", "null", "undefined",
    "api", "www", "near", "help", "root", "bot", "official",
    "staff", "team", "mod", "dev", "test", "login", "signup",
    "settings", "profile", "upload", "cabinet", "requests", "song",
    "genre", "about", "terms", "privacy",
];

/// Validate a slug for Google users (used at creation and rename).
pub fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.len() < 5 {
        return Err("Username must be at least 5 characters".into());
    }
    if slug.len() > 30 {
        return Err("Username must be at most 30 characters".into());
    }
    if !slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err("Username may only contain lowercase letters, digits, and hyphens".into());
    }
    if slug.contains('.') {
        return Err("Username must not contain dots".into());
    }
    if slug.starts_with('-') || slug.ends_with('-') {
        return Err("Username must not start or end with a hyphen".into());
    }
    if slug.contains("--") {
        return Err("Username must not contain consecutive hyphens".into());
    }
    if RESERVED_SLUGS.contains(&slug) {
        return Err("This username is reserved".into());
    }
    Ok(())
}

fn generate_slug(display_name: &str) -> String {
    let base: String = display_name
        .to_lowercase()
        .chars()
        .filter(|c| *c != '.') // remove dots
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let base = if base.is_empty() || base.len() < 3 { "user".to_string() } else { base };
    let suffix = &uuid::Uuid::new_v4().to_string()[..6];
    let slug = format!("{}-{}", base, suffix);

    // Ensure generated slug passes validation (fallback if not)
    if validate_slug(&slug).is_err() {
        let fallback = &uuid::Uuid::new_v4().to_string()[..8];
        return format!("user-{}", fallback);
    }
    slug
}

// ── Get current user ──

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: i32,
    pub slug: String,
    pub account_id: String, // slug for backward compat
    pub near_account_id: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_admin: bool,
    pub is_banned: bool,
    pub is_premium: bool,
    pub premium_until: Option<String>,
    pub auth_provider: String,
    pub reputation_score: String,
}

/// GET /api/auth/me — get current authenticated user
pub async fn get_me(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let user = sqlx::query_as::<_, crate::db::models::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (is_premium, premium_until) = compute_premium(&user);

    Ok(Json(MeResponse {
        id: user.id,
        slug: user.slug.clone(),
        account_id: user.slug,
        near_account_id: user.account_id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_admin: user.is_admin,
        is_banned: user.is_banned,
        is_premium,
        premium_until,
        auth_provider: user.auth_provider,
        reputation_score: user.reputation_score.to_string(),
    }))
}

// ── Logout ──

/// POST /api/auth/logout — clear wallet link and session
pub async fn logout(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if let Ok(claims) = require_auth(&extensions) {
        // Clear linked NEAR wallet
        sqlx::query("UPDATE users SET account_id = NULL WHERE id = $1")
            .bind(claims.user_id)
            .execute(&state.db)
            .await
            .ok();
    }

    // Clear session cookie
    let clear_cookie = "nearfm_session=; Domain=.near.fm; Path=/; Max-Age=0";
    let clear_cookie_local = "nearfm_session=; Path=/; Max-Age=0";

    Ok((
        [
            (header::SET_COOKIE, clear_cookie.to_string()),
            (header::SET_COOKIE, clear_cookie_local.to_string()),
        ],
        StatusCode::OK,
    ))
}

// ── Link NEAR wallet to existing account ──

#[derive(Debug, Deserialize)]
pub struct LinkWalletRequest {
    pub account_id: String,
}

/// POST /api/auth/link-wallet — link a NEAR wallet to an authenticated account
/// No signature needed — user is already authenticated via JWT (Google or NEAR).
/// Wallet ownership is enforced at transaction time by wallet-selector.
pub async fn link_wallet(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<LinkWalletRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if req.account_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "account_id is required".to_string()));
    }

    // Check if this NEAR account is already linked to another user
    if let Some(existing) = queries::get_user_by_account(&state.db, &req.account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        if existing.id != claims.user_id {
            return Err((StatusCode::CONFLICT, "This NEAR account is already linked to another user".to_string()));
        }
    }

    // Link the wallet
    let user = queries::link_near_wallet(&state.db, claims.user_id, &req.account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Issue new JWT with updated account_id
    let is_admin = state.config.is_admin(&req.account_id) || user.is_admin;
    if is_admin != user.is_admin {
        sqlx::query("UPDATE users SET is_admin = $1 WHERE id = $2")
            .bind(is_admin)
            .bind(user.id)
            .execute(&state.db)
            .await
            .ok();
    }

    let token = jwt::create_token(
        &state.config.jwt_secret,
        &user.slug,
        user.id,
        is_admin,
        Some(&req.account_id),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Token error: {}", e)))?;

    let cookie = build_session_cookie(&token, &state.config.frontend_url);

    let (is_premium, premium_until) = compute_premium(&user);

    let body = Json(VerifyResponse {
        token,
        user: UserResponse {
            id: user.id,
            account_id: user.slug.clone(),
            slug: user.slug,
            display_name: user.display_name,
            is_admin,
            is_premium,
            premium_until,
            reputation_score: user.reputation_score.to_string(),
            auth_provider: user.auth_provider,
            near_account_id: Some(req.account_id),
        },
    });

    Ok(([(header::SET_COOKIE, cookie)], body))
}
