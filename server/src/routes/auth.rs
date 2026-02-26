use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{jwt, nep413},
    db::queries,
    AppState,
};

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
    pub account_id: String,
    pub display_name: Option<String>,
    pub is_admin: bool,
    pub reputation_score: String,
}

pub async fn verify(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, (StatusCode, String)> {
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
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {}", e),
            )
        })?;

    // 4. Create JWT
    let token = jwt::create_token(
        &state.config.jwt_secret,
        &user.account_id,
        user.id,
        user.is_admin,
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Token error: {}", e),
        )
    })?;

    Ok(Json(VerifyResponse {
        token,
        user: UserResponse {
            id: user.id,
            account_id: user.account_id,
            display_name: user.display_name,
            is_admin: user.is_admin,
            reputation_score: user.reputation_score.to_string(),
        },
    }))
}
