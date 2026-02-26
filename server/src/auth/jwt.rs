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
    pub sub: String,       // account_id
    pub user_id: i32,
    pub is_admin: bool,
    pub exp: usize,
}

pub fn create_token(
    secret: &str,
    account_id: &str,
    user_id: i32,
    is_admin: bool,
) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: account_id.to_string(),
        user_id,
        is_admin,
        exp: expiration,
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

/// Auth middleware — extracts JWT from Authorization header, sets claims as extension.
/// Does NOT reject unauthenticated requests — routes check claims themselves.
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    if let Some(auth_header) = req.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                if let Ok(claims) = decode_token(&state.config.jwt_secret, token) {
                    req.extensions_mut().insert(claims);
                }
            }
        }
    }
    next.run(req).await
}

/// Extract claims from request extensions. Returns 401 if not authenticated.
pub fn require_auth(extensions: &axum::http::Extensions) -> Result<&Claims, StatusCode> {
    extensions.get::<Claims>().ok_or(StatusCode::UNAUTHORIZED)
}

/// Extract claims and require admin. Returns 403 if not admin.
pub fn require_admin(extensions: &axum::http::Extensions) -> Result<&Claims, StatusCode> {
    let claims = require_auth(extensions)?;
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(claims)
}
