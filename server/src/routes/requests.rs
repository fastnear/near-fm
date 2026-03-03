use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::require_auth,
    db::{models::SongRequest, queries},
    near::tx_verify,
    AppState,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SubmissionWithSong {
    pub id: i32,
    pub request_id: i32,
    pub song_id: i32,
    pub submitter_id: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub song_uuid: String,
    pub song_title: String,
    pub song_cover_image_url: Option<String>,
    pub submitter_account_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ListRequestsQuery {
    pub status: Option<String>,
    pub sort: Option<String>,
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RequestsListResponse {
    pub requests: Vec<SongRequestWithRequester>,
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
        "bounty" => "CAST(sr.bounty_amount_yocto AS NUMERIC) DESC",
        _ => "sr.created_at DESC",
    };

    let sql = format!(
        "SELECT sr.*, u.slug AS requester_account_id, \
         (SELECT COUNT(*) FROM songs s WHERE s.fulfills_request_id = sr.id AND NOT s.is_hidden AND NOT s.is_deleted) AS submission_count \
         FROM song_requests sr JOIN users u ON u.id = sr.requester_id \
         WHERE sr.status = $1 AND NOT sr.is_hidden ORDER BY {} LIMIT $2 OFFSET $3",
        order
    );

    let requests = sqlx::query_as::<_, SongRequestWithRequester>(&sql)
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
    pub uuid: Option<String>,
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

    // Check if user is banned
    let is_banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Your account has been banned".to_string()));
    }

    let uuid = req.uuid.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let request = sqlx::query_as::<_, SongRequest>(
        r#"INSERT INTO song_requests
            (uuid, requester_id, title, description, bounty_amount_yocto, bounty_tx_hash, language_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '30 days')
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

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SongRequestWithRequester {
    pub id: i32,
    pub uuid: String,
    pub requester_id: i32,
    pub title: String,
    pub description: String,
    pub bounty_amount_yocto: String,
    pub bounty_tx_hash: String,
    pub status: String,
    pub awarded_song_id: Option<i32>,
    pub award_tx_hash: Option<String>,
    pub withdrawal_penalty_yocto: Option<String>,
    pub withdrawal_tx_hash: Option<String>,
    pub language_id: Option<i32>,
    pub is_hidden: bool,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub requester_account_id: String,
    pub submission_count: Option<i64>,
}

pub async fn get_request(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Result<Json<SongRequestWithRequester>, (StatusCode, String)> {
    let request = sqlx::query_as::<_, SongRequestWithRequester>(
        "SELECT sr.*, u.slug AS requester_account_id, \
         (SELECT COUNT(*) FROM songs s WHERE s.fulfills_request_id = sr.id AND NOT s.is_hidden AND NOT s.is_deleted) AS submission_count \
         FROM song_requests sr JOIN users u ON u.id = sr.requester_id WHERE sr.uuid = $1",
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

    // Require a linked NEAR wallet for bounty operations
    let near_account = claims.account_id.as_deref().ok_or_else(|| {
        (StatusCode::FORBIDDEN, "Connect a NEAR wallet to manage bounties".to_string())
    })?;

    // Verify on-chain transactions
    if req.status == "awarded" {
        if let Some(ref tx_hash) = req.award_tx_hash {
            let verified = tx_verify::verify_near_tx(
                &state.config.near_rpc_url,
                tx_hash,
                near_account,
            )
            .await
            .map_err(|e| {
                tracing::warn!("Award TX verification failed for {}: {}", tx_hash, e);
                (StatusCode::BAD_REQUEST, format!("Transaction verification failed: {}", e))
            })?;

            if verified.method_name != "award_bounty" {
                return Err((StatusCode::BAD_REQUEST, "Wrong contract method for award".to_string()));
            }
            if verified.receiver_id != state.config.contract_id {
                return Err((StatusCode::BAD_REQUEST, "Transaction sent to wrong contract".to_string()));
            }
        }
    }

    if req.status == "withdrawn" {
        if let Some(ref tx_hash) = req.withdrawal_tx_hash {
            let verified = tx_verify::verify_near_tx(
                &state.config.near_rpc_url,
                tx_hash,
                near_account,
            )
            .await
            .map_err(|e| {
                tracing::warn!("Withdraw TX verification failed for {}: {}", tx_hash, e);
                (StatusCode::BAD_REQUEST, format!("Transaction verification failed: {}", e))
            })?;

            if verified.method_name != "withdraw_bounty" {
                return Err((StatusCode::BAD_REQUEST, "Wrong contract method for withdrawal".to_string()));
            }
            if verified.receiver_id != state.config.contract_id {
                return Err((StatusCode::BAD_REQUEST, "Transaction sent to wrong contract".to_string()));
            }
        }
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

    // Send notifications when bounty is awarded
    if req.status == "awarded" {
        if let Some(awarded_song_id) = req.awarded_song_id {
            // Get all submissions for this request
            let submissions = sqlx::query_as::<_, (i32, i32)>(
                "SELECT submitter_id, song_id FROM request_submissions WHERE request_id = $1"
            )
            .bind(existing.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            // Get the winning song title
            let winner_title: Option<String> = sqlx::query_scalar(
                "SELECT title FROM songs WHERE id = $1"
            )
            .bind(awarded_song_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

            for (submitter_id, song_id) in &submissions {
                if *song_id == awarded_song_id {
                    // Notify the winner
                    queries::create_notification(
                        &state.db,
                        *submitter_id,
                        "bounty_awarded",
                        &serde_json::json!({
                            "request_uuid": uuid,
                            "request_title": existing.title,
                            "song_title": winner_title,
                            "bounty_amount_yocto": existing.bounty_amount_yocto,
                        }),
                    )
                    .await
                    .ok();
                } else {
                    // Notify losers — encourage to keep participating
                    let loser_song_title: Option<String> = sqlx::query_scalar(
                        "SELECT title FROM songs WHERE id = $1"
                    )
                    .bind(song_id)
                    .fetch_optional(&state.db)
                    .await
                    .unwrap_or(None);

                    queries::create_notification(
                        &state.db,
                        *submitter_id,
                        "bounty_not_awarded",
                        &serde_json::json!({
                            "request_uuid": uuid,
                            "request_title": existing.title,
                            "song_title": loser_song_title,
                        }),
                    )
                    .await
                    .ok();
                }
            }
        }
    }

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

    // Check if user is banned
    let is_banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Your account has been banned".to_string()));
    }

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

pub async fn list_submissions(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Result<Json<Vec<SubmissionWithSong>>, (StatusCode, String)> {
    let request = sqlx::query_as::<_, SongRequest>(
        "SELECT * FROM song_requests WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Request not found".to_string()))?;

    let submissions = sqlx::query_as::<_, SubmissionWithSong>(
        r#"SELECT rs.id, rs.request_id, rs.song_id, rs.submitter_id, rs.created_at,
                  s.uuid AS song_uuid, s.title AS song_title, s.cover_image_url AS song_cover_image_url,
                  u.slug AS submitter_account_id
           FROM request_submissions rs
           JOIN songs s ON s.id = rs.song_id
           JOIN users u ON u.id = rs.submitter_id
           WHERE rs.request_id = $1 AND NOT s.is_deleted
           ORDER BY rs.created_at DESC"#,
    )
    .bind(request.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(submissions))
}
