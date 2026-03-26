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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solana_address: Option<String>,
}

pub fn create_token(
    secret: &str,
    slug: &str,
    user_id: i32,
    is_admin: bool,
    account_id: Option<&str>,
    solana_address: Option<&str>,
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
        solana_address: solana_address.map(|s| s.to_string()),
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

/// Auth middleware — extracts JWT from Authorization header or cookie, sets claims as extension.
/// Does NOT reject unauthenticated requests — routes check claims themselves.
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let mut token_found = None;

    // 1. Check Authorization header
    if let Some(auth_header) = req.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                token_found = Some(token.to_string());
            }
        }
    }

    // 2. Fallback: check nearfm_session cookie
    if token_found.is_none() {
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

    // 3. JWT decode
    if let Some(token) = token_found {
        if let Ok(claims) = decode_token(&state.config.jwt_secret, &token) {
            req.extensions_mut().insert(claims);
        }
    }

    next.run(req).await
}

/// Extract claims from request extensions. Returns 401 if not authenticated.
pub fn require_auth(extensions: &axum::http::Extensions) -> Result<&Claims, StatusCode> {
    extensions.get::<Claims>().ok_or(StatusCode::UNAUTHORIZED)
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
