use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::{require_auth, Claims},
    db::{models::SongWithUploader, queries},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct ListSongsQuery {
    pub sort: Option<String>,
    pub period: Option<String>,
    pub lang: Option<i32>,
    pub category: Option<i32>,
    pub q: Option<String>,
    pub audio_hash: Option<String>,
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SongsListResponse {
    pub songs: Vec<SongWithUploader>,
    pub page: i64,
    pub limit: i64,
}

pub async fn list_songs(
    State(state): State<AppState>,
    Query(params): Query<ListSongsQuery>,
) -> Result<Json<SongsListResponse>, (StatusCode, String)> {
    let limit = params.limit.unwrap_or(20).min(100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * limit;
    let sort = params.sort.as_deref().unwrap_or("trending");

    // Check for audio_hash deduplication query
    if let Some(ref hash) = params.audio_hash {
        let exists = queries::check_audio_hash_exists(&state.db, hash)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if exists {
            return Err((StatusCode::CONFLICT, "Audio file already uploaded".to_string()));
        }
        return Ok(Json(SongsListResponse {
            songs: vec![],
            page: 1,
            limit: 0,
        }));
    }

    let songs = queries::list_songs(
        &state.db,
        sort,
        params.lang,
        params.category,
        params.q.as_deref(),
        params.period.as_deref(),
        limit,
        offset,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(SongsListResponse { songs, page, limit }))
}

#[derive(Debug, Deserialize)]
pub struct CreateSongRequest {
    pub title: String,
    pub description: Option<String>,
    pub lyrics: Option<String>,
    pub ai_model: Option<String>,
    pub audio_url: String,
    pub audio_hash: String,
    pub audio_duration_seconds: Option<i32>,
    pub audio_mime_type: Option<String>,
    pub cover_image_url: Option<String>,
    pub language_id: Option<i32>,
    pub fulfills_request_id: Option<i32>,
}

pub async fn create_song(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateSongRequest>,
) -> Result<Json<SongWithUploader>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Check deduplication
    let exists = queries::check_audio_hash_exists(&state.db, &req.audio_hash)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if exists {
        return Err((StatusCode::CONFLICT, "Audio file already uploaded".to_string()));
    }

    let uuid = uuid::Uuid::new_v4().to_string();
    let mime = req.audio_mime_type.as_deref().unwrap_or("audio/mpeg");

    let song = queries::create_song(
        &state.db,
        &uuid,
        claims.user_id,
        &req.title,
        req.description.as_deref(),
        req.lyrics.as_deref(),
        req.ai_model.as_deref(),
        &req.audio_url,
        &req.audio_hash,
        req.audio_duration_seconds,
        mime,
        req.cover_image_url.as_deref(),
        req.language_id,
        req.fulfills_request_id,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Increment uploader's total_uploads
    sqlx::query("UPDATE users SET total_uploads = total_uploads + 1 WHERE id = $1")
        .bind(claims.user_id)
        .execute(&state.db)
        .await
        .ok();

    // Spawn background audio validation
    crate::validation::spawn_validation(state.db.clone(), song.id, req.audio_url.clone());

    // Return song with uploader info
    let result = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Song not found after create".to_string()))?;

    Ok(Json(result))
}

pub async fn get_song(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Result<Json<SongDetailResponse>, (StatusCode, String)> {
    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    if song.is_hidden || song.is_deleted {
        return Err((StatusCode::NOT_FOUND, "Song not found".to_string()));
    }

    Ok(Json(SongDetailResponse { song }))
}

#[derive(Debug, Serialize)]
pub struct SongDetailResponse {
    pub song: SongWithUploader,
}

#[derive(Debug, Deserialize)]
pub struct VoteRequest {
    pub value: i16,
}

#[derive(Debug, Serialize)]
pub struct VoteResponse {
    pub upvotes: i32,
    pub downvotes: i32,
    pub user_vote: i16,
}

pub async fn vote_song(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<VoteRequest>,
) -> Result<Json<VoteResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if req.value != 1 && req.value != -1 {
        return Err((StatusCode::BAD_REQUEST, "Vote value must be 1 or -1".to_string()));
    }

    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    // Get voter's reputation for vote weight
    let voter = queries::get_user_by_account(&state.db, &claims.sub)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    use std::str::FromStr;
    let weight: f64 = f64::from_str(&voter.reputation_score.to_string()).unwrap_or(1.0);

    queries::upsert_vote(&state.db, song.id, claims.user_id, req.value, weight)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get updated counts
    let updated = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    Ok(Json(VoteResponse {
        upvotes: updated.upvotes,
        downvotes: updated.downvotes,
        user_vote: req.value,
    }))
}

#[derive(Debug, Serialize)]
pub struct PlayCountResponse {
    pub play_count: i32,
}

pub async fn increment_play(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Result<Json<PlayCountResponse>, (StatusCode, String)> {
    let count = queries::increment_play_count(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(PlayCountResponse { play_count: count }))
}

#[derive(Debug, Deserialize)]
pub struct ReportSongRequest {
    pub reason: String,
}

pub async fn report_song(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<ReportSongRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    sqlx::query(
        "INSERT INTO reports (song_id, reporter_id, reason) VALUES ($1, $2, $3)",
    )
    .bind(song.id)
    .bind(claims.user_id)
    .bind(&req.reason)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::CREATED)
}
