use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::require_auth,
    db::{models::SongRequest, queries},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListRequestsQuery {
    pub status: Option<String>,
    pub sort: Option<String>,
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RequestsListResponse {
    pub requests: Vec<SongRequest>,
    pub page: i64,
}

pub async fn list_requests(
    State(state): State<AppState>,
    Query(params): Query<ListRequestsQuery>,
) -> Result<Json<RequestsListResponse>, (StatusCode, String)> {
    let limit = params.limit.unwrap_or(20).min(100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * limit;
    let status = params.status.as_deref().unwrap_or("open");
    let sort = params.sort.as_deref().unwrap_or("latest");

    let order = match sort {
        "bounty" => "CAST(bounty_amount_yocto AS NUMERIC) DESC",
        _ => "created_at DESC",
    };

    let sql = format!(
        "SELECT * FROM song_requests WHERE status = $1 ORDER BY {} LIMIT $2 OFFSET $3",
        order
    );

    let requests = sqlx::query_as::<_, SongRequest>(&sql)
        .bind(status)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(RequestsListResponse { requests, page }))
}

#[derive(Debug, Deserialize)]
pub struct CreateRequestBody {
    pub title: String,
    pub description: String,
    pub bounty_tx_hash: String,
    pub bounty_amount_yocto: String,
    pub language_id: Option<i32>,
}

pub async fn create_request(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateRequestBody>,
) -> Result<Json<SongRequest>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let uuid = uuid::Uuid::new_v4().to_string();

    let request = sqlx::query_as::<_, SongRequest>(
        r#"INSERT INTO song_requests
            (uuid, requester_id, title, description, bounty_amount_yocto, bounty_tx_hash, language_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *"#,
    )
    .bind(&uuid)
    .bind(claims.user_id)
    .bind(&req.title)
    .bind(&req.description)
    .bind(&req.bounty_amount_yocto)
    .bind(&req.bounty_tx_hash)
    .bind(req.language_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(request))
}

pub async fn get_request(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Result<Json<SongRequest>, (StatusCode, String)> {
    let request = sqlx::query_as::<_, SongRequest>(
        "SELECT * FROM song_requests WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Request not found".to_string()))?;

    Ok(Json(request))
}

#[derive(Debug, Deserialize)]
pub struct UpdateRequestBody {
    pub status: String,
    pub awarded_song_id: Option<i32>,
    pub award_tx_hash: Option<String>,
    pub withdrawal_tx_hash: Option<String>,
}

pub async fn update_request(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<UpdateRequestBody>,
) -> Result<Json<SongRequest>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Verify ownership
    let existing = sqlx::query_as::<_, SongRequest>(
        "SELECT * FROM song_requests WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Request not found".to_string()))?;

    if existing.requester_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not the request owner".to_string()));
    }

    let updated = sqlx::query_as::<_, SongRequest>(
        r#"UPDATE song_requests SET
            status = $1,
            awarded_song_id = COALESCE($2, awarded_song_id),
            award_tx_hash = COALESCE($3, award_tx_hash),
            withdrawal_tx_hash = COALESCE($4, withdrawal_tx_hash),
            updated_at = NOW()
           WHERE uuid = $5
           RETURNING *"#,
    )
    .bind(&req.status)
    .bind(req.awarded_song_id)
    .bind(&req.award_tx_hash)
    .bind(&req.withdrawal_tx_hash)
    .bind(&uuid)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(updated))
}

#[derive(Debug, Deserialize)]
pub struct SubmitToRequestBody {
    pub song_uuid: String,
}

pub async fn submit_to_request(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<SubmitToRequestBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let request = sqlx::query_as::<_, SongRequest>(
        "SELECT * FROM song_requests WHERE uuid = $1 AND status = 'open'",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Open request not found".to_string()))?;

    let song = queries::get_song_by_uuid(&state.db, &req.song_uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    sqlx::query(
        r#"INSERT INTO request_submissions (request_id, song_id, submitter_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(request.id)
    .bind(song.id)
    .bind(claims.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Notify the requester
    queries::create_notification(
        &state.db,
        request.requester_id,
        "submission_to_request",
        &serde_json::json!({
            "request_uuid": uuid,
            "song_uuid": req.song_uuid,
            "submitter": claims.sub,
        }),
    )
    .await
    .ok();

    Ok(StatusCode::CREATED)
}
