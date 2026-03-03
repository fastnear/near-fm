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
    pub genre: Option<String>,
    pub lang_code: Option<String>,
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
    extensions: Extensions,
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

    // Load user feed exclusions if authenticated
    let (excluded_genre_ids, excluded_language_ids, excluded_category_ids, hide_no_cover) =
        if let Some(claims) = extensions.get::<crate::auth::jwt::Claims>() {
            let rows: Vec<(String, i32)> = sqlx::query_as(
                "SELECT exclusion_type, exclusion_id FROM user_feed_exclusions WHERE user_id = $1"
            )
            .bind(claims.user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            let mut eg = Vec::new();
            let mut el = Vec::new();
            let mut ec = Vec::new();
            let mut no_cover = false;
            for (t, id) in rows {
                match t.as_str() {
                    "genre" => eg.push(id),
                    "language" => el.push(id),
                    "category" => ec.push(id),
                    "no_cover" => no_cover = true,
                    _ => {}
                }
            }
            (eg, el, ec, no_cover)
        } else {
            (vec![], vec![], vec![], false)
        };

    // For "following" sort, pass the user_id to filter by followed authors
    let follower_user_id = if sort == "following" {
        extensions.get::<crate::auth::jwt::Claims>().map(|c| c.user_id)
    } else {
        None
    };

    let songs = queries::list_songs(
        &state.db,
        sort,
        params.lang,
        params.category,
        params.q.as_deref(),
        params.period.as_deref(),
        params.genre.as_deref(),
        params.lang_code.as_deref(),
        &excluded_genre_ids,
        &excluded_language_ids,
        &excluded_category_ids,
        hide_no_cover,
        limit,
        offset,
        follower_user_id,
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
    pub category_id: Option<i32>,
    pub fulfills_request_id: Option<i32>,
    pub genre_ids: Option<Vec<i32>>,
}

pub async fn create_song(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateSongRequest>,
) -> Result<Json<SongWithUploader>, (StatusCode, String)> {
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
        req.category_id,
        req.fulfills_request_id,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Set genres
    if let Some(ref genre_ids) = req.genre_ids {
        queries::set_song_genres(&state.db, song.id, genre_ids)
            .await
            .ok();
    }

    // Increment uploader's total_uploads
    sqlx::query("UPDATE users SET total_uploads = total_uploads + 1 WHERE id = $1")
        .bind(claims.user_id)
        .execute(&state.db)
        .await
        .ok();

    // Auto-submit to bounty request if fulfills_request_id is set
    if let Some(request_id) = req.fulfills_request_id {
        if let Ok(Some(request)) = sqlx::query_as::<_, crate::db::models::SongRequest>(
            "SELECT * FROM song_requests WHERE id = $1 AND status = 'open'"
        )
        .bind(request_id)
        .fetch_optional(&state.db)
        .await
        {
            // Create submission record
            sqlx::query(
                "INSERT INTO request_submissions (request_id, song_id, submitter_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
            )
            .bind(request.id)
            .bind(song.id)
            .bind(claims.user_id)
            .execute(&state.db)
            .await
            .ok();

            // Notify the requester
            queries::create_notification(
                &state.db,
                request.requester_id,
                "submission_to_request",
                &serde_json::json!({
                    "request_uuid": request.uuid,
                    "song_uuid": uuid,
                    "song_title": req.title,
                    "submitter": claims.sub,
                }),
            )
            .await
            .ok();
        }
    }

    // Spawn background audio validation
    crate::validation::spawn_validation(state.db.clone(), song.id, req.audio_url.clone(), req.cover_image_url.clone());

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

    // Check if user is banned
    let is_banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Your account has been banned".to_string()));
    }

    if req.value != 1 && req.value != -1 && req.value != 0 {
        return Err((StatusCode::BAD_REQUEST, "Vote value must be 1, -1, or 0".to_string()));
    }

    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    if req.value == 0 {
        // Remove vote
        queries::delete_vote(&state.db, song.id, claims.user_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    } else {
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
    }

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

pub async fn get_vote(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
) -> Result<Json<VoteResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    let user_vote = queries::get_user_vote(&state.db, song.id, claims.user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .unwrap_or(0);

    Ok(Json(VoteResponse {
        upvotes: song.upvotes,
        downvotes: song.downvotes,
        user_vote,
    }))
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

#[derive(Debug, Deserialize)]
pub struct UpdateSongRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub lyrics: Option<String>,
    pub ai_model: Option<String>,
    pub cover_image_url: Option<String>,
    pub language_id: Option<i32>,
    pub category_id: Option<i32>,
    pub genre_ids: Option<Vec<i32>>,
    #[serde(default)]
    pub remove_cover: bool,
}

pub async fn update_song(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<UpdateSongRequest>,
) -> Result<Json<SongDetailResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    // Only owner or admin can edit
    if song.uploader_id != claims.user_id && !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Not authorized to edit this song".to_string()));
    }

    sqlx::query(
        r#"UPDATE songs SET
            title = COALESCE($1, title),
            description = COALESCE($2, description),
            lyrics = COALESCE($3, lyrics),
            ai_model = COALESCE($4, ai_model),
            cover_image_url = CASE WHEN $6 THEN NULL WHEN $5 IS NOT NULL THEN $5 ELSE cover_image_url END,
            language_id = COALESCE($7, language_id),
            category_id = COALESCE($8, category_id),
            updated_at = NOW()
           WHERE uuid = $9"#,
    )
    .bind(&req.title)
    .bind(&req.description)
    .bind(&req.lyrics)
    .bind(&req.ai_model)
    .bind(&req.cover_image_url)
    .bind(req.remove_cover)
    .bind(&req.language_id)
    .bind(&req.category_id)
    .bind(&uuid)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update genres if provided
    if let Some(ref genre_ids) = req.genre_ids {
        queries::set_song_genres(&state.db, song.id, genre_ids)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let updated = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Song not found after update".to_string()))?;

    Ok(Json(SongDetailResponse { song: updated }))
}

pub async fn get_radio(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<Vec<crate::db::models::SongWithUploader>>, (StatusCode, String)> {
    // Get top 100 trending songs
    let top_songs = queries::get_top_trending_songs(&state.db, 100)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if top_songs.is_empty() {
        return Ok(Json(vec![]));
    }

    // Get user preferences if authenticated
    let prefs = if let Some(claims) = extensions.get::<Claims>() {
        queries::get_user_vote_preferences(&state.db, claims.user_id)
            .await
            .ok()
    } else {
        None
    };

    // Do all randomization in a sync block so rng doesn't cross await
    let result = select_radio_songs(top_songs, prefs);

    Ok(Json(result))
}

fn select_radio_songs(
    top_songs: Vec<crate::db::models::SongWithUploader>,
    prefs: Option<(Vec<i32>, Vec<i32>)>,
) -> Vec<crate::db::models::SongWithUploader> {
    use rand::seq::SliceRandom;
    use rand::Rng;

    let mut rng = rand::thread_rng();

    if let Some((pref_genres, pref_langs)) = prefs {
        if pref_genres.is_empty() && pref_langs.is_empty() {
            let mut songs = top_songs;
            songs.shuffle(&mut rng);
            songs.truncate(30);
            return songs;
        }

        // Weighted random selection
        let weights: Vec<f64> = top_songs
            .iter()
            .map(|s| {
                let mut w: f64 = 1.0;
                for g in &s.genres {
                    if pref_genres.contains(&g.id) {
                        w += 0.5;
                        break;
                    }
                }
                if let Some(lid) = s.language_id {
                    if pref_langs.contains(&lid) {
                        w += 0.3;
                    }
                }
                w
            })
            .collect();

        let mut indices: Vec<usize> = (0..top_songs.len()).collect();
        let mut selected = Vec::with_capacity(30);

        for _ in 0..30.min(top_songs.len()) {
            if indices.is_empty() {
                break;
            }
            let total: f64 = indices.iter().map(|&i| weights[i]).sum();
            let mut r = rng.gen::<f64>() * total;
            let mut pick = 0;
            for (pos, &idx) in indices.iter().enumerate() {
                r -= weights[idx];
                if r <= 0.0 {
                    pick = pos;
                    break;
                }
            }
            let idx = indices.remove(pick);
            selected.push(idx);
        }

        selected.into_iter().map(|i| top_songs[i].clone()).collect()
    } else {
        let mut songs = top_songs;
        songs.shuffle(&mut rng);
        songs.truncate(30);
        songs
    }
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
