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

use super::truncate_str;

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

    // Load user feed exclusions and blocked users if authenticated
    let (excluded_genre_ids, excluded_language_ids, excluded_category_ids, hide_no_cover, blocked_user_ids) =
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

            let blocked: Vec<(i32,)> = sqlx::query_as(
                "SELECT blocked_id FROM user_blocks WHERE blocker_id = $1"
            )
            .bind(claims.user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            let blocked_ids: Vec<i32> = blocked.into_iter().map(|(id,)| id).collect();

            (eg, el, ec, no_cover, blocked_ids)
        } else {
            (vec![], vec![], vec![], false, vec![])
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
        &blocked_user_ids,
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
    pub suno_task_id: Option<String>,
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

    // Truncate fields to reasonable limits
    let title = truncate_str(&req.title, 200);
    let description = req.description.as_deref().map(|s| truncate_str(s, 5000));
    let lyrics = req.lyrics.as_deref().map(|s| truncate_str(s, 10000));

    // Check deduplication
    let exists = queries::check_audio_hash_exists(&state.db, &req.audio_hash)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if exists {
        return Err((StatusCode::CONFLICT, "Audio file already uploaded".to_string()));
    }

    let uuid = uuid::Uuid::new_v4().to_string();
    let mime = req.audio_mime_type.as_deref().unwrap_or("audio/mpeg");

    // Song is "created on near.fm" if a suno_task_id was provided (generated via our pipeline)
    let created_on_nearfm = req.suno_task_id.is_some();

    let song = queries::create_song(
        &state.db,
        &uuid,
        claims.user_id,
        &title,
        description.as_deref(),
        lyrics.as_deref(),
        req.ai_model.as_deref(),
        &req.audio_url,
        &req.audio_hash,
        req.audio_duration_seconds,
        mime,
        req.cover_image_url.as_deref(),
        req.language_id,
        req.category_id,
        req.fulfills_request_id,
        created_on_nearfm,
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
    pub diamond_like_count: i32,
    pub user_has_diamond_liked: bool,
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
        let weight: f64 = sqlx::query_scalar::<_, f64>(
            "SELECT reputation_score FROM users WHERE id = $1"
        )
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(1.0);

        queries::upsert_vote(&state.db, song.id, claims.user_id, req.value, weight)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        // Mutual exclusion: upvote removes diamond like
        if req.value == 1 {
            let has_diamond = queries::get_user_diamond_like(&state.db, song.id, claims.user_id)
                .await
                .unwrap_or(false);
            if has_diamond {
                let _ = queries::toggle_diamond_like(&state.db, song.id, claims.user_id).await;
            }
        }
    }

    // Get updated counts
    let updated = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    let user_has_diamond_liked = queries::get_user_diamond_like(&state.db, updated.id, claims.user_id)
        .await
        .unwrap_or(false);

    Ok(Json(VoteResponse {
        upvotes: updated.upvotes,
        downvotes: updated.downvotes,
        user_vote: req.value,
        diamond_like_count: updated.diamond_like_count,
        user_has_diamond_liked,
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

    let user_has_diamond_liked = queries::get_user_diamond_like(&state.db, song.id, claims.user_id)
        .await
        .unwrap_or(false);

    Ok(Json(VoteResponse {
        upvotes: song.upvotes,
        downvotes: song.downvotes,
        user_vote,
        diamond_like_count: song.diamond_like_count,
        user_has_diamond_liked,
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

    // Get user preferences, blocked users, skips, and author sentiments if authenticated
    let (prefs, blocked_user_ids, excluded_genre_ids, excluded_language_ids, excluded_category_ids, hide_no_cover, skipped_song_ids, author_sentiments) =
        if let Some(claims) = extensions.get::<Claims>() {
            let p = queries::get_user_vote_preferences(&state.db, claims.user_id)
                .await
                .ok();

            let blocked: Vec<(i32,)> = sqlx::query_as(
                "SELECT blocked_id FROM user_blocks WHERE blocker_id = $1"
            )
            .bind(claims.user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            let blocked_ids: Vec<i32> = blocked.into_iter().map(|(id,)| id).collect();

            let excl_rows: Vec<(String, i32)> = sqlx::query_as(
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
            for (t, id) in excl_rows {
                match t.as_str() {
                    "genre" => eg.push(id),
                    "language" => el.push(id),
                    "category" => ec.push(id),
                    "no_cover" => no_cover = true,
                    _ => {}
                }
            }

            // Load skipped song IDs (last 30 days)
            let skips: Vec<(i32,)> = sqlx::query_as(
                "SELECT song_id FROM radio_skips WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'"
            )
            .bind(claims.user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();
            let skip_ids: Vec<i32> = skips.into_iter().map(|(id,)| id).collect();

            // Load net sentiment per author: +1 liked, -1 disliked (aggregated from votes)
            let sentiments: Vec<(i32, i64)> = sqlx::query_as(
                r#"SELECT s.uploader_id, SUM(v.value::BIGINT) AS net
                   FROM votes v
                   JOIN songs s ON v.song_id = s.id
                   WHERE v.user_id = $1
                   GROUP BY s.uploader_id"#
            )
            .bind(claims.user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            (p, blocked_ids, eg, el, ec, no_cover, skip_ids, sentiments)
        } else {
            (None, vec![], vec![], vec![], vec![], false, vec![], vec![])
        };

    // Filter out blocked users and excluded content from radio pool
    let top_songs: Vec<_> = top_songs.into_iter().filter(|s| {
        if !blocked_user_ids.is_empty() && blocked_user_ids.contains(&s.uploader_id) {
            return false;
        }
        if !excluded_genre_ids.is_empty() && s.genres.iter().any(|g| excluded_genre_ids.contains(&g.id)) {
            return false;
        }
        if !excluded_language_ids.is_empty() {
            if let Some(lid) = s.language_id {
                if excluded_language_ids.contains(&lid) {
                    return false;
                }
            }
        }
        if !excluded_category_ids.is_empty() {
            if let Some(cid) = s.category_id {
                if excluded_category_ids.contains(&cid) {
                    return false;
                }
            }
        }
        if hide_no_cover && s.cover_image_url.is_none() {
            return false;
        }
        true
    }).collect();

    if top_songs.is_empty() {
        return Ok(Json(vec![]));
    }

    // Do all randomization in a sync block so rng doesn't cross await
    let result = select_radio_songs(top_songs, prefs, &skipped_song_ids, &author_sentiments);

    Ok(Json(result))
}

/// Radio song selection with personalized weights.
///
/// Weight formula per song (for logged-in users):
///   w = 1.0 (base)
///     + 0.3  if song genre matches user's upvoted genres
///     + 0.5  if song language matches user's upvoted languages
///     + 0.6  if user has net positive votes on this author's songs
///     - 0.6  if user has net negative votes on this author's songs
///     - 0.45 if user skipped this song in radio (≈ 3/4 of a dislike, one skip per song)
///   minimum weight: 0.1
///
/// For anonymous users: uniform random shuffle, pick 30.
fn select_radio_songs(
    top_songs: Vec<crate::db::models::SongWithUploader>,
    prefs: Option<(Vec<i32>, Vec<i32>)>,
    skipped_song_ids: &[i32],
    author_sentiments: &[(i32, i64)],
) -> Vec<crate::db::models::SongWithUploader> {
    use rand::seq::SliceRandom;
    use rand::Rng;

    let mut rng = rand::thread_rng();

    let has_signals = prefs.is_some() || !skipped_song_ids.is_empty() || !author_sentiments.is_empty();

    if !has_signals {
        let mut songs = top_songs;
        songs.shuffle(&mut rng);
        songs.truncate(30);
        return songs;
    }

    let (pref_genres, pref_langs) = prefs.unwrap_or_default();

    // Weighted random selection
    let weights: Vec<f64> = top_songs
        .iter()
        .map(|s| {
            let mut w: f64 = 1.0;

            // Genre preference bonus
            if !pref_genres.is_empty() {
                for g in &s.genres {
                    if pref_genres.contains(&g.id) {
                        w += 0.3;
                        break;
                    }
                }
            }

            // Language preference bonus
            if !pref_langs.is_empty() {
                if let Some(lid) = s.language_id {
                    if pref_langs.contains(&lid) {
                        w += 0.5;
                    }
                }
            }

            // Author sentiment: liked author → bonus, disliked → penalty
            if let Some(&(_, net)) = author_sentiments.iter().find(|(uid, _)| *uid == s.uploader_id) {
                if net > 0 {
                    w += 0.6;
                } else if net < 0 {
                    w -= 0.6;
                }
            }

            // Skip penalty (one skip per song, ≈ 3/4 dislike)
            if skipped_song_ids.contains(&s.id) {
                w -= 0.45;
            }

            w.max(0.1)
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
}

#[derive(Debug, Deserialize)]
pub struct RadioSkipRequest {
    pub song_uuid: String,
}

pub async fn radio_skip(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<RadioSkipRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let song = queries::get_song_by_uuid(&state.db, &req.song_uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    sqlx::query(
        "INSERT INTO radio_skips (user_id, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(claims.user_id)
    .bind(song.id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::CREATED)
}

#[derive(Debug, Serialize)]
pub struct DiamondLikeResponse {
    pub diamond_like_count: i32,
    pub user_has_diamond_liked: bool,
    pub diamond_likes_remaining_today: i64,
}

pub async fn diamond_like_song(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
) -> Result<Json<DiamondLikeResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Check premium status
    let premium_until: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT premium_until FROM users WHERE id = $1")
            .bind(claims.user_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let is_premium = premium_until
        .map(|until| until > chrono::Utc::now())
        .unwrap_or(false);

    if !is_premium && !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Premium subscription required".to_string()));
    }

    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    // Check if user already has a diamond like on this song (to know if this is a removal)
    let already_liked = queries::get_user_diamond_like(&state.db, song.id, claims.user_id)
        .await
        .unwrap_or(false);

    // If adding (not removing), check daily limit
    if !already_liked {
        let today_count = queries::get_diamond_likes_today(&state.db, claims.user_id)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if today_count >= 5 {
            return Err((StatusCode::TOO_MANY_REQUESTS, "Daily diamond like limit reached (5/day)".to_string()));
        }
    }

    let now_liked = queries::toggle_diamond_like(&state.db, song.id, claims.user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Mutual exclusion: adding diamond like removes regular upvote
    if now_liked {
        let current_vote: Option<i16> = sqlx::query_scalar(
            "SELECT value FROM votes WHERE song_id = $1 AND user_id = $2"
        )
        .bind(song.id)
        .bind(claims.user_id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);
        if current_vote == Some(1) {
            let _ = queries::delete_vote(&state.db, song.id, claims.user_id).await;
        }
    }

    let updated = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    let today_count = queries::get_diamond_likes_today(&state.db, claims.user_id)
        .await
        .unwrap_or(0);

    Ok(Json(DiamondLikeResponse {
        diamond_like_count: updated.diamond_like_count,
        user_has_diamond_liked: now_liked,
        diamond_likes_remaining_today: (5 - today_count).max(0),
    }))
}

pub async fn get_diamond_likes_remaining(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let today_count = queries::get_diamond_likes_today(&state.db, claims.user_id)
        .await
        .unwrap_or(0);

    Ok(Json(serde_json::json!({
        "diamond_likes_remaining_today": (5 - today_count).max(0),
        "diamond_likes_used_today": today_count,
        "diamond_likes_daily_limit": 5
    })))
}

pub async fn get_diamond_likers(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Result<Json<Vec<queries::DiamondLiker>>, (StatusCode, String)> {
    let song = queries::get_song_by_uuid(&state.db, &uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    let likers = queries::get_diamond_likers(&state.db, song.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(likers))
}

// ── Song stats for owner ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TipItem {
    pub tipper_account_id: String,
    pub amount_yocto: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct TipStats {
    pub total_yocto: String,
    pub count: i64,
    pub items: Vec<TipItem>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CommentItem {
    pub id: i32,
    pub body: String,
    pub is_hidden: bool,
    pub author_account_id: String,
    pub author_display_name: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct CommentStats {
    pub count: i64,
    pub items: Vec<CommentItem>,
}

#[derive(Debug, Serialize)]
pub struct LikeStats {
    pub upvotes: i32,
    pub downvotes: i32,
    pub diamond_likes: i32,
}

#[derive(Debug, Serialize)]
pub struct SongMyStatsResponse {
    pub song_uuid: String,
    pub tips: TipStats,
    pub comments: CommentStats,
    pub likes: LikeStats,
}

#[derive(sqlx::FromRow)]
struct SongStatsRow {
    id: i32,
    uploader_id: i32,
    upvotes: i32,
    downvotes: i32,
    diamond_like_count: i32,
    total_tips_yocto: String,
}

pub async fn get_song_my_stats(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
) -> Result<Json<SongMyStatsResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Lightweight query — no JOINs needed, just ownership + stats fields
    let song: SongStatsRow = sqlx::query_as(
        "SELECT id, uploader_id, upvotes, downvotes, diamond_like_count, total_tips_yocto \
         FROM songs WHERE uuid = $1 AND NOT is_deleted",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    if song.uploader_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not your song".to_string()));
    }

    // All 4 data queries run concurrently
    let (tips_count, tip_items, comments_count, comment_items) = tokio::try_join!(
        async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tips WHERE song_id = $1")
                .bind(song.id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        },
        async {
            sqlx::query_as::<_, TipItem>(
                r#"SELECT u.slug AS tipper_account_id, t.amount_yocto, t.created_at
                   FROM tips t
                   JOIN users u ON u.id = t.tipper_id
                   WHERE t.song_id = $1
                   ORDER BY t.created_at DESC
                   LIMIT 100"#,
            )
            .bind(song.id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        },
        async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM comments WHERE song_id = $1")
                .bind(song.id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        },
        async {
            sqlx::query_as::<_, CommentItem>(
                r#"SELECT c.id, c.body, c.is_hidden,
                          u.slug AS author_account_id, u.display_name AS author_display_name,
                          c.created_at
                   FROM comments c
                   JOIN users u ON u.id = c.user_id
                   WHERE c.song_id = $1
                   ORDER BY c.created_at DESC
                   LIMIT 100"#,
            )
            .bind(song.id)
            .fetch_all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
        },
    )?;

    Ok(Json(SongMyStatsResponse {
        song_uuid: uuid,
        tips: TipStats {
            total_yocto: song.total_tips_yocto,
            count: tips_count,
            items: tip_items,
        },
        comments: CommentStats {
            count: comments_count,
            items: comment_items,
        },
        likes: LikeStats {
            upvotes: song.upvotes,
            downvotes: song.downvotes,
            diamond_likes: song.diamond_like_count,
        },
    }))
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
    .bind(&truncate_str(&req.reason, 2000))
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::CREATED)
}
