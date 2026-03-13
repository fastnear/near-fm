use axum::{
    extract::{Path, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{auth::{api_key, jwt}, AppState};

#[derive(Debug, Deserialize)]
pub struct CreateKeyRequest {
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateKeyResponse {
    pub key: String,
    pub id: i32,
    pub label: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ApiKeyInfo {
    pub id: i32,
    pub label: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub revoked_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn create_api_key(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateKeyRequest>,
) -> Result<Json<CreateKeyResponse>, (StatusCode, String)> {
    let claims = jwt::require_jwt_auth(&extensions)
        .map_err(|s| (s, "API key creation requires a browser session (not an API key)".to_string()))?;

    // Limit active keys per user
    let active_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if active_count >= 10 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Maximum 10 active API keys per user".to_string(),
        ));
    }

    let key = api_key::generate_api_key();
    let key_hash = api_key::hash_api_key(&key);
    let label = req.label.unwrap_or_default();

    let row: (i32, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "INSERT INTO api_keys (user_id, key_hash, label) VALUES ($1, $2, $3) RETURNING id, created_at",
    )
    .bind(claims.user_id)
    .bind(&key_hash)
    .bind(&label)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!(user_id = claims.user_id, key_id = row.0, "API key created");

    Ok(Json(CreateKeyResponse {
        key,
        id: row.0,
        label,
        created_at: row.1,
    }))
}

pub async fn list_api_keys(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<Vec<ApiKeyInfo>>, (StatusCode, String)> {
    let claims = jwt::require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let keys = sqlx::query_as::<_, ApiKeyInfo>(
        "SELECT id, label, created_at, revoked_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
    )
    .bind(claims.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(keys))
}

pub async fn revoke_api_key(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(key_id): Path<i32>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = jwt::require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let rows_affected = sqlx::query(
        "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(key_id)
    .bind(claims.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .rows_affected();

    if rows_affected == 0 {
        return Err((StatusCode::NOT_FOUND, "API key not found or already revoked".to_string()));
    }

    // Invalidate cache for this user
    state.api_key_cache.invalidate_user(claims.user_id).await;

    tracing::info!(user_id = claims.user_id, key_id = key_id, "API key revoked");

    Ok(StatusCode::NO_CONTENT)
}
