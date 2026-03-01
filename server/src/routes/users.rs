use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::require_auth,
    db::{models::SongWithUploader, queries},
    AppState,
};

#[derive(Debug, Serialize)]
pub struct UserProfileResponse {
    pub account_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub reputation_score: String,
    pub total_uploads: i32,
    pub total_tips_received_yocto: String,
    pub total_likes_given: i64,
    pub total_dislikes_given: i64,
    pub created_at: String,
    pub songs: Vec<SongWithUploader>,
}

pub async fn get_profile(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<UserProfileResponse>, (StatusCode, String)> {
    let user = queries::get_user_by_account(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let songs = sqlx::query_as::<_, SongWithUploader>(
        r#"SELECT s.*,
            u.account_id AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation
           FROM songs s
           JOIN users u ON s.uploader_id = u.id
           WHERE s.uploader_id = $1 AND NOT s.is_deleted AND NOT s.is_hidden
           ORDER BY s.created_at DESC
           LIMIT 50"#,
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get vote activity stats
    let (total_likes_given, total_dislikes_given): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) FROM votes WHERE user_id = $1"
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(UserProfileResponse {
        account_id: user.account_id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        reputation_score: user.reputation_score.to_string(),
        total_uploads: user.total_uploads,
        total_tips_received_yocto: user.total_tips_received_yocto,
        total_likes_given,
        total_dislikes_given,
        created_at: user.created_at.to_rfc3339(),
        songs,
    }))
}

#[derive(Debug, Deserialize)]
pub struct BookmarkRequest {
    pub song_uuid: String,
}

pub async fn add_bookmark(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
    Json(req): Json<BookmarkRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub != account_id {
        return Err((StatusCode::FORBIDDEN, "Cannot bookmark for another user".to_string()));
    }

    let song = queries::get_song_by_uuid(&state.db, &req.song_uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    queries::add_bookmark(&state.db, claims.user_id, song.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::CREATED)
}

pub async fn remove_bookmark(
    State(state): State<AppState>,
    Path((account_id, song_uuid)): Path<(String, String)>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub != account_id {
        return Err((StatusCode::FORBIDDEN, "Cannot modify another user's bookmarks".to_string()));
    }

    let song = queries::get_song_by_uuid(&state.db, &song_uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    queries::remove_bookmark(&state.db, claims.user_id, song.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_bookmarks(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
) -> Result<Json<Vec<SongWithUploader>>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub != account_id {
        return Err((StatusCode::FORBIDDEN, "Cannot view another user's bookmarks".to_string()));
    }

    let songs = sqlx::query_as::<_, SongWithUploader>(
        r#"SELECT s.*,
            u.account_id AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation
           FROM bookmarks b
           JOIN songs s ON b.song_id = s.id
           JOIN users u ON s.uploader_id = u.id
           WHERE b.user_id = $1 AND NOT s.is_deleted AND NOT s.is_hidden
           ORDER BY b.created_at DESC"#,
    )
    .bind(claims.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(songs))
}
