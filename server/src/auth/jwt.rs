use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,       // slug (universal identifier)
    pub user_id: i32,
    pub is_admin: bool,
    pub exp: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,  // NEAR wallet account, if linked
}

pub fn create_token(
    secret: &str,
    slug: &str,
    user_id: i32,
    is_admin: bool,
    account_id: Option<&str>,
) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(365))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: slug.to_string(),
        user_id,
        is_admin,
        exp: expiration,
        account_id: account_id.map(|s| s.to_string()),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn decode_token(secret: &str, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}

/// Auth middleware — extracts JWT or API key from Authorization header, sets claims as extension.
/// Does NOT reject unauthenticated requests — routes check claims themselves.
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let mut token_found = None;
    let mut api_key_resolved = false;

    // 1. Check Authorization header
    if let Some(auth_header) = req.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                if token.starts_with("nfm_") {
                    // API key path — resolve to Claims via cache/DB
                    if let Some(claims) = resolve_api_key(&state, token).await {
                        req.extensions_mut().insert(claims);
                        api_key_resolved = true;
                    }
                } else {
                    token_found = Some(token.to_string());
                }
            }
        }
    }

    // 2. Fallback: check nearfm_session cookie (only if no API key resolved)
    if !api_key_resolved && token_found.is_none() {
        if let Some(cookie_header) = req.headers().get("cookie") {
            if let Ok(cookies) = cookie_header.to_str() {
                for part in cookies.split(';') {
                    let part = part.trim();
                    if let Some(val) = part.strip_prefix("nearfm_session=") {
                        token_found = Some(val.to_string());
                        break;
                    }
                }
            }
        }
    }

    // 3. JWT decode (if token found and not already resolved via API key)
    if !api_key_resolved {
        if let Some(token) = token_found {
            if let Ok(claims) = decode_token(&state.config.jwt_secret, &token) {
                req.extensions_mut().insert(claims);
            }
        }
    }

    next.run(req).await
}

/// Resolve an API key (nfm_...) to Claims via cache or DB lookup.
async fn resolve_api_key(state: &AppState, key: &str) -> Option<Claims> {
    use super::api_key;

    let key_hash = api_key::hash_api_key(key);

    // Check cache first
    if let Some(data) = state.api_key_cache.get(&key_hash).await {
        return Some(Claims {
            sub: data.slug,
            user_id: data.user_id,
            is_admin: data.is_admin,
            exp: usize::MAX,
            account_id: data.account_id,
        });
    }

    // DB lookup
    let row: Option<(i32, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.slug, u.is_admin, u.account_id \
         FROM api_keys ak JOIN users u ON u.id = ak.user_id \
         WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL",
    )
    .bind(&key_hash)
    .fetch_optional(&state.db)
    .await
    .ok()?;

    let (user_id, slug, is_admin, account_id) = row?;

    let data = api_key::CachedKeyData {
        user_id,
        slug: slug.clone(),
        is_admin,
        account_id: account_id.clone(),
    };
    state.api_key_cache.set(key_hash, data).await;

    Some(Claims {
        sub: slug,
        user_id,
        is_admin,
        exp: usize::MAX,
        account_id,
    })
}

/// Extract claims from request extensions. Returns 401 if not authenticated.
pub fn require_auth(extensions: &axum::http::Extensions) -> Result<&Claims, StatusCode> {
    extensions.get::<Claims>().ok_or(StatusCode::UNAUTHORIZED)
}

/// Extract claims but only accept JWT sessions (not API keys).
/// API key claims use exp = usize::MAX as a marker.
pub fn require_jwt_auth(extensions: &axum::http::Extensions) -> Result<&Claims, StatusCode> {
    let claims = require_auth(extensions)?;
    if claims.exp == usize::MAX {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(claims)
}

/// Extract claims if present (no error if not authenticated).
pub fn try_auth(extensions: &axum::http::Extensions) -> Option<&Claims> {
    extensions.get::<Claims>()
}

/// Extract claims and require admin. Returns 403 if not admin.
pub fn require_admin(extensions: &axum::http::Extensions) -> Result<&Claims, StatusCode> {
    let claims = require_auth(extensions)?;
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(claims)
}
