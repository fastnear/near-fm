use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::{require_admin, require_auth},
    db::models::{Category, Genre, Language, Report, PlatformConfig},
    db::queries,
    AppState,
};

const VIDEO_DIR: &str = "/app/video";

// ── Categories ──

pub async fn list_categories(
    State(state): State<AppState>,
) -> Result<Json<Vec<Category>>, (StatusCode, String)> {
    let categories = crate::db::queries::list_categories(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(categories))
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub display_order: Option<i32>,
}

pub async fn create_category(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<Json<Category>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let cat = sqlx::query_as::<_, Category>(
        r#"INSERT INTO categories (name, slug, description, display_order)
           VALUES ($1, $2, $3, $4)
           RETURNING *"#,
    )
    .bind(&req.name)
    .bind(&req.slug)
    .bind(&req.description)
    .bind(req.display_order.unwrap_or(0))
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(cat))
}

pub async fn delete_category(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query("DELETE FROM categories WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── Reports ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReportWithContext {
    pub id: i32,
    pub song_id: i32,
    pub reporter_id: i32,
    pub reason: String,
    pub status: String,
    pub reviewed_by: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub song_uuid: String,
    pub song_title: String,
    pub reporter_account_id: String,
}

pub async fn list_reports(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<Vec<ReportWithContext>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let reports = sqlx::query_as::<_, ReportWithContext>(
        r#"SELECT r.id, r.song_id, r.reporter_id, r.reason, r.status, r.reviewed_by, r.created_at,
                  s.uuid AS song_uuid, s.title AS song_title,
                  u.slug AS reporter_account_id
           FROM reports r
           JOIN songs s ON s.id = r.song_id
           JOIN users u ON u.id = r.reporter_id
           WHERE r.status = 'pending'
           ORDER BY r.created_at DESC LIMIT 100"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(reports))
}

#[derive(Debug, Deserialize)]
pub struct ReviewReportRequest {
    pub status: String,  // "reviewed" or "dismissed"
    pub action: Option<String>,  // "hide" or "delete"
}

pub async fn review_report(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    extensions: Extensions,
    Json(req): Json<ReviewReportRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let report = sqlx::query_as::<_, Report>(
        "SELECT * FROM reports WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Report not found".to_string()))?;

    // Update report status
    sqlx::query(
        "UPDATE reports SET status = $1, reviewed_by = $2 WHERE id = $3",
    )
    .bind(&req.status)
    .bind(claims.user_id)
    .bind(id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Apply action to song
    if req.status == "reviewed" {
        match req.action.as_deref() {
            Some("hide") => {
                sqlx::query("UPDATE songs SET is_hidden = TRUE WHERE id = $1")
                    .bind(report.song_id)
                    .execute(&state.db)
                    .await
                    .ok();

                // Notify the uploader
                if let Ok(Some(song)) = sqlx::query_as::<_, (i32, String, String)>(
                    "SELECT uploader_id, title, uuid FROM songs WHERE id = $1"
                )
                .bind(report.song_id)
                .fetch_optional(&state.db)
                .await
                {
                    queries::create_notification(
                        &state.db,
                        song.0,
                        "song_hidden",
                        &serde_json::json!({
                            "song_title": song.1,
                            "song_uuid": song.2,
                        }),
                    )
                    .await
                    .ok();
                }
            }
            Some("delete") => {
                sqlx::query("UPDATE songs SET is_deleted = TRUE WHERE id = $1")
                    .bind(report.song_id)
                    .execute(&state.db)
                    .await
                    .ok();
            }
            _ => {}
        }
    }

    Ok(StatusCode::OK)
}

// ── Song moderation ──

#[derive(Debug, Deserialize)]
pub struct ModerateSongRequest {
    pub category_id: Option<i32>,
    pub language_id: Option<i32>,
    pub is_hidden: Option<bool>,
    pub genre_ids: Option<Vec<i32>>,
}

pub async fn moderate_song(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<ModerateSongRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query(
        r#"UPDATE songs SET
            category_id = COALESCE($1, category_id),
            is_hidden = COALESCE($2, is_hidden),
            language_id = COALESCE($3, language_id),
            updated_at = NOW()
           WHERE uuid = $4"#,
    )
    .bind(req.category_id)
    .bind(req.is_hidden)
    .bind(req.language_id)
    .bind(&uuid)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Notify uploader when song is hidden
    if req.is_hidden == Some(true) {
        if let Ok(Some(song)) = sqlx::query_as::<_, (i32, String)>(
            "SELECT uploader_id, title FROM songs WHERE uuid = $1"
        )
        .bind(&uuid)
        .fetch_optional(&state.db)
        .await
        {
            queries::create_notification(
                &state.db,
                song.0,
                "song_hidden",
                &serde_json::json!({
                    "song_title": song.1,
                    "song_uuid": uuid,
                }),
            )
            .await
            .ok();
        }
    }

    // Update genres if provided
    if let Some(ref genre_ids) = req.genre_ids {
        let song_id: Option<i32> = sqlx::query_scalar("SELECT id FROM songs WHERE uuid = $1")
            .bind(&uuid)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if let Some(song_id) = song_id {
            queries::set_song_genres(&state.db, song_id, genre_ids)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }

    Ok(StatusCode::OK)
}

pub async fn delete_song(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query("UPDATE songs SET is_deleted = TRUE WHERE uuid = $1")
        .bind(&uuid)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── Request moderation ──

#[derive(Debug, Deserialize)]
pub struct AdminListRequestsQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminRequestRow {
    pub id: i32,
    pub uuid: String,
    pub requester_id: i32,
    pub title: String,
    pub description: String,
    pub bounty_amount_yocto: String,
    pub bounty_tx_hash: Option<String>,
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
}

pub async fn list_requests(
    State(state): State<AppState>,
    extensions: Extensions,
    axum::extract::Query(params): axum::extract::Query<AdminListRequestsQuery>,
) -> Result<Json<Vec<AdminRequestRow>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let limit = params.limit.unwrap_or(100).min(200);

    let requests = if let Some(status) = &params.status {
        sqlx::query_as::<_, AdminRequestRow>(
            "SELECT sr.*, u.slug AS requester_account_id FROM song_requests sr JOIN users u ON u.id = sr.requester_id WHERE sr.status = $1 ORDER BY sr.created_at DESC LIMIT $2"
        )
        .bind(status)
        .bind(limit)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, AdminRequestRow>(
            "SELECT sr.*, u.slug AS requester_account_id FROM song_requests sr JOIN users u ON u.id = sr.requester_id ORDER BY sr.created_at DESC LIMIT $1"
        )
        .bind(limit)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(requests))
}

#[derive(Debug, Deserialize)]
pub struct ModerateRequestBody {
    pub is_hidden: Option<bool>,
    pub title: Option<String>,
    pub description: Option<String>,
}

pub async fn moderate_request(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<ModerateRequestBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query(
        r#"UPDATE song_requests SET
            is_hidden = COALESCE($1, is_hidden),
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            updated_at = NOW()
           WHERE uuid = $4"#,
    )
    .bind(req.is_hidden)
    .bind(&req.title)
    .bind(&req.description)
    .bind(&uuid)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::OK)
}

// ── Platform config ──

pub async fn get_config(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<Vec<PlatformConfig>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let config = sqlx::query_as::<_, PlatformConfig>(
        "SELECT * FROM platform_config ORDER BY key",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(config))
}

#[derive(Debug, Deserialize)]
pub struct UpdateConfigRequest {
    pub key: String,
    pub value: String,
}

pub async fn update_config(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<UpdateConfigRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query(
        "INSERT INTO platform_config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
    )
    .bind(&req.key)
    .bind(&req.value)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::OK)
}

// ── Song scores (admin analytics) ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminSongScore {
    pub uuid: String,
    pub title: String,
    pub uploader_account_id: String,
    pub score: f64,
    pub upvotes: i32,
    pub downvotes: i32,
    pub weighted_upvotes: f64,
    pub weighted_downvotes: f64,
    pub play_count: i32,
    pub play_score: f64,
    pub tips_near: f64,
    pub tips_score: f64,
    pub newbie_multiplier: f64,
    pub genre_multiplier: f64,
    pub language_multiplier: f64,
    pub lyrics_multiplier: f64,
    pub cover_multiplier: f64,
    pub age_hours: f64,
    pub age_divisor: f64,
    pub base_score: f64,
    pub is_hidden: bool,
    pub is_deleted: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub genre_ids: Vec<i32>,
    pub language_id: Option<i32>,
    pub audio_duration_seconds: Option<i32>,
}

pub async fn list_song_scores(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<Vec<AdminSongScore>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let songs = sqlx::query_as::<_, AdminSongScore>(
        r#"
        SELECT
            s.uuid,
            s.title,
            u.slug AS uploader_account_id,
                u.account_id AS uploader_near_account_id,
            s.score,
            s.upvotes,
            s.downvotes,
            COALESCE(v_agg.weighted_upvotes, 0)::FLOAT8 AS weighted_upvotes,
            COALESCE(v_agg.weighted_downvotes, 0)::FLOAT8 AS weighted_downvotes,
            s.play_count,
            (LOG(GREATEST(s.play_count, 1)::NUMERIC) * 2)::FLOAT8 AS play_score,
            (CAST(s.total_tips_yocto AS NUMERIC) / 1e24)::FLOAT8 AS tips_near,
            (LOG(GREATEST(CAST(s.total_tips_yocto AS NUMERIC) / 1e24, 0.01) + 1) * 9)::FLOAT8 AS tips_score,
            (CASE
                WHEN u.total_uploads < 3 AND u.reputation_score < 1.5 THEN 0.5
                ELSE 1.0
            END)::FLOAT8 AS newbie_multiplier,
            (CASE WHEN NOT EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id) THEN 0.7 ELSE 1.0 END)::FLOAT8 AS genre_multiplier,
            (CASE WHEN s.language_id IS NULL THEN 0.7 ELSE 1.0 END)::FLOAT8 AS language_multiplier,
            (CASE WHEN s.lyrics IS NULL OR s.lyrics = '' THEN 0.7 WHEN LENGTH(s.lyrics) < 200 THEN 0.85 ELSE 1.0 END)::FLOAT8 AS lyrics_multiplier,
            (CASE WHEN s.cover_image_url IS NULL THEN 0.7 ELSE 1.0 END)::FLOAT8 AS cover_multiplier,
            (EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600.0)::FLOAT8 AS age_hours,
            POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600.0 - 24, 0) + 2, 1.8)::FLOAT8 AS age_divisor,
            (
                (
                    COALESCE(v_agg.weighted_upvotes, 0)
                    - COALESCE(v_agg.weighted_downvotes, 0)
                    + LOG(GREATEST(s.play_count, 1)::NUMERIC) * 2
                    + LOG(GREATEST(CAST(s.total_tips_yocto AS NUMERIC) / 1e24, 0.01) + 1) * 9
                )
                * CASE
                    WHEN u.total_uploads < 3 AND u.reputation_score < 1.5 THEN 0.5
                    ELSE 1.0
                  END
                * CASE WHEN NOT EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id) THEN 0.7 ELSE 1.0 END
                * CASE WHEN s.language_id IS NULL THEN 0.7 ELSE 1.0 END
                * CASE WHEN s.lyrics IS NULL OR s.lyrics = '' THEN 0.7 WHEN LENGTH(s.lyrics) < 200 THEN 0.85 ELSE 1.0 END
                * CASE WHEN s.cover_image_url IS NULL THEN 0.7 ELSE 1.0 END
            )::FLOAT8 AS base_score,
            s.is_hidden,
            s.is_deleted,
            s.created_at,
            ARRAY(SELECT sg.genre_id FROM song_genres sg WHERE sg.song_id = s.id) AS genre_ids,
            s.language_id,
            s.audio_duration_seconds
        FROM songs s
        JOIN users u ON u.id = s.uploader_id
        LEFT JOIN (
            SELECT
                v.song_id,
                SUM(CASE WHEN v.value > 0
                    THEN v.value::NUMERIC * v.weight
                         * CASE WHEN vu.reputation_score <= 1.0 THEN 0.5 ELSE 1.0 END
                    ELSE 0 END) AS weighted_upvotes,
                SUM(CASE WHEN v.value < 0
                    THEN ABS(v.value::NUMERIC * v.weight)
                         * CASE WHEN vu.reputation_score <= 1.0 THEN 0.5 ELSE 1.0 END
                    ELSE 0 END) AS weighted_downvotes
            FROM votes v
            JOIN users vu ON vu.id = v.user_id
            GROUP BY v.song_id
        ) v_agg ON v_agg.song_id = s.id
        WHERE s.is_deleted = FALSE
        ORDER BY s.score DESC
        LIMIT 500
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(songs))
}

// ── Users list ──

#[derive(Debug, Deserialize)]
pub struct AdminUsersQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct AdminUserRow {
    pub id: i32,
    pub slug: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub auth_provider: String,
    pub account_id: Option<String>,
    pub is_banned: bool,
    pub is_muted: bool,
    pub reputation_score: f64,
    pub total_uploads: i32,
    pub total_tips_received_yocto: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn admin_list_users(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(params): Query<AdminUsersQuery>,
) -> Result<Json<Vec<AdminUserRow>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let limit = params.limit.unwrap_or(50).min(200);
    let offset = (params.page.unwrap_or(1) - 1).max(0) * limit;

    let users = if let Some(ref q) = params.q {
        let pattern = format!("%{}%", q.to_lowercase());
        sqlx::query_as::<_, AdminUserRow>(
            r#"SELECT id, slug, display_name, avatar_url, auth_provider, account_id,
                      is_banned, is_muted, reputation_score, total_uploads,
                      total_tips_received_yocto, created_at
               FROM users
               WHERE LOWER(slug) LIKE $1
                  OR LOWER(COALESCE(display_name, '')) LIKE $1
                  OR LOWER(COALESCE(account_id, '')) LIKE $1
               ORDER BY created_at DESC
               LIMIT $2 OFFSET $3"#,
        )
        .bind(&pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, AdminUserRow>(
            r#"SELECT id, slug, display_name, avatar_url, auth_provider, account_id,
                      is_banned, is_muted, reputation_score, total_uploads,
                      total_tips_received_yocto, created_at
               FROM users
               ORDER BY created_at DESC
               LIMIT $1 OFFSET $2"#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(users))
}

// ── Ban user ──

#[derive(Debug, Deserialize)]
pub struct BanUserBody {
    pub is_banned: bool,
}

pub async fn admin_toggle_ban(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
    Json(req): Json<BanUserBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    // Get the user id
    let user_id: Option<i32> = sqlx::query_scalar(
        "SELECT id FROM users WHERE slug = $1",
    )
    .bind(&account_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_id = user_id.ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    // Update ban status
    sqlx::query("UPDATE users SET is_banned = $1 WHERE id = $2")
        .bind(req.is_banned)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if req.is_banned {
        // Hide all songs
        sqlx::query("UPDATE songs SET is_hidden = TRUE WHERE uploader_id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
            .ok();

        // Hide all comments
        sqlx::query("UPDATE comments SET is_hidden = TRUE WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
            .ok();

        // Delete all votes and recalculate affected songs
        let affected_song_ids: Vec<i32> = sqlx::query_scalar(
            "SELECT DISTINCT song_id FROM votes WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        sqlx::query("DELETE FROM votes WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
            .ok();

        // Recalculate vote counts for affected songs
        for song_id in affected_song_ids {
            sqlx::query(
                r#"UPDATE songs SET
                    upvotes = COALESCE((SELECT COUNT(*) FROM votes WHERE song_id = $1 AND value = 1), 0),
                    downvotes = COALESCE((SELECT COUNT(*) FROM votes WHERE song_id = $1 AND value = -1), 0)
                   WHERE id = $1"#,
            )
            .bind(song_id)
            .execute(&state.db)
            .await
            .ok();
        }
    } else {
        // Unban: restore songs and comments
        sqlx::query("UPDATE songs SET is_hidden = FALSE WHERE uploader_id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
            .ok();

        sqlx::query("UPDATE comments SET is_hidden = FALSE WHERE user_id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await
            .ok();
    }

    Ok(StatusCode::OK)
}

// ── Genres ──

pub async fn list_genres(
    State(state): State<AppState>,
) -> Result<Json<Vec<Genre>>, (StatusCode, String)> {
    let genres = queries::list_genres(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(genres))
}

#[derive(Debug, Deserialize)]
pub struct CreateGenreRequest {
    pub name: String,
    pub slug: String,
    pub display_order: Option<i32>,
}

pub async fn create_genre(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateGenreRequest>,
) -> Result<Json<Genre>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let genre = sqlx::query_as::<_, Genre>(
        r#"INSERT INTO genres (name, slug, display_order)
           VALUES ($1, $2, $3)
           RETURNING *"#,
    )
    .bind(&req.name)
    .bind(&req.slug)
    .bind(req.display_order.unwrap_or(0))
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(genre))
}

pub async fn delete_genre(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query("DELETE FROM genres WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── Languages ──

pub async fn list_languages(
    State(state): State<AppState>,
) -> Result<Json<Vec<Language>>, (StatusCode, String)> {
    let languages = queries::list_languages(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(languages))
}

#[derive(Debug, Deserialize)]
pub struct CreateLanguageRequest {
    pub name: String,
    pub code: String,
}

pub async fn create_language(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateLanguageRequest>,
) -> Result<Json<Language>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let lang = sqlx::query_as::<_, Language>(
        r#"INSERT INTO languages (name, code)
           VALUES ($1, $2)
           RETURNING *"#,
    )
    .bind(&req.name)
    .bind(&req.code)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(lang))
}

pub async fn delete_language(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query("DELETE FROM languages WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── Credits Financial Tracking ──

#[derive(Debug, Serialize)]
pub struct CreditsSummary {
    pub total_topup_credits: i64,
    pub total_spent_credits: i64,
    pub total_refunded_credits: i64,
    pub net_balance: i64,
    pub total_premium_purchases: i64,
    pub total_premium_days: i64,
}

pub async fn credits_summary(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<CreditsSummary>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin access required".to_string()))?;

    let row: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            (SELECT COALESCE(SUM(credits_added::bigint), 0)::bigint FROM credit_topups),
            (SELECT COALESCE(SUM(from_purchased::bigint), 0)::bigint FROM credit_usage WHERE credits_spent > 0),
            (SELECT COALESCE(SUM(ABS(from_purchased::bigint)), 0)::bigint FROM credit_usage WHERE credits_spent < 0)
        "#,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let prem: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::bigint, COALESCE(SUM(days_added::bigint), 0)::bigint FROM premium_purchases",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(CreditsSummary {
        total_topup_credits: row.0,
        total_spent_credits: row.1,
        total_refunded_credits: row.2,
        net_balance: row.0 - row.1 + row.2,
        total_premium_purchases: prem.0,
        total_premium_days: prem.1,
    }))
}

#[derive(Debug, Deserialize)]
pub struct TransactionsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CreditTransaction {
    pub r#type: String,
    pub slug: String,
    pub amount: i32,
    pub detail: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn credits_transactions(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(q): Query<TransactionsQuery>,
) -> Result<Json<Vec<CreditTransaction>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin access required".to_string()))?;

    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);

    let rows = sqlx::query_as::<_, CreditTransaction>(
        r#"
        SELECT * FROM (
            SELECT 'topup' as type, u.slug, ct.credits_added as amount, ct.token as detail, ct.created_at
            FROM credit_topups ct JOIN users u ON u.id = ct.user_id
            UNION ALL
            SELECT
                CASE WHEN cu.credits_spent < 0 THEN 'refund' ELSE 'usage' END as type,
                u.slug, cu.credits_spent as amount, cu.action as detail, cu.created_at
            FROM credit_usage cu JOIN users u ON u.id = cu.user_id
            UNION ALL
            SELECT 'premium' as type, u.slug, pp.days_added as amount,
                CASE WHEN pp.gifted_by_user_id IS NOT NULL
                    THEN 'gift from ' || COALESCE(g.display_name, g.slug)
                    ELSE pp.token
                END as detail,
                pp.created_at
            FROM premium_purchases pp
            JOIN users u ON u.id = pp.user_id
            LEFT JOIN users g ON g.id = pp.gifted_by_user_id
        ) combined
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
        "#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(rows))
}

// ── Tips list (admin) ──

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminTipRow {
    pub id: i32,
    pub tipper_slug: String,
    pub recipient_slug: String,
    pub song_title: Option<String>,
    pub song_uuid: Option<String>,
    pub amount_yocto: Option<String>,
    pub amount_usd_cents: Option<i32>,
    pub payment_method: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_tips(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<Vec<AdminTipRow>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let rows = sqlx::query_as::<_, AdminTipRow>(
        r#"SELECT t.id, u1.slug AS tipper_slug, u2.slug AS recipient_slug,
           s.title AS song_title, s.uuid AS song_uuid,
           t.amount_yocto, t.amount_usd_cents, t.payment_method, t.created_at
           FROM tips t
           JOIN users u1 ON u1.id = t.tipper_id
           JOIN users u2 ON u2.id = t.recipient_id
           LEFT JOIN songs s ON s.id = t.song_id
           ORDER BY t.created_at DESC
           LIMIT 200"#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(rows))
}

// ── Video Generation ──

#[derive(Serialize)]
pub struct VideoStatus {
    pub exists: bool,
    pub url: Option<String>,
}

/// Check whether a generated video exists for this song.
pub async fn video_status(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Json<VideoStatus> {
    // Check DB first
    let db_url: Option<String> = sqlx::query_scalar(
        "SELECT video_url FROM songs WHERE uuid = $1 AND NOT is_deleted"
    ).bind(&uuid).fetch_optional(&state.db).await.ok().flatten();
    if let Some(url) = db_url {
        return Json(VideoStatus { exists: true, url: Some(url) });
    }
    // Fallback: filesystem check (for in-progress generations)
    let path = format!("{}/{}.mp4", VIDEO_DIR, uuid);
    let exists = std::path::Path::new(&path).exists();
    if exists {
        // Backfill DB
        let token = generate_video_token();
        let url = format!("/video/{}_{}.mp4", uuid, token);
        // Rename file to include token
        let new_path = format!("{}/{}_{}.mp4", VIDEO_DIR, uuid, token);
        let _ = std::fs::rename(&path, &new_path);
        let _ = sqlx::query("UPDATE songs SET video_url = $1, video_token = $2 WHERE uuid = $3")
            .bind(&url).bind(&token).bind(&uuid).execute(&state.db).await;
        return Json(VideoStatus { exists: true, url: Some(url) });
    }
    Json(VideoStatus { exists: false, url: None })
}

fn generate_video_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{:x}", t)
}

/// Internal helper: spawn video generation and save to DB when done.
pub fn spawn_video_generation(db: sqlx::PgPool, uuid: String, audio_url: String, cover_url: Option<String>) {
    let token = generate_video_token();
    let filename = format!("{}_{}.mp4", uuid, token);
    let output_path = format!("{}/{}", VIDEO_DIR, filename);
    let video_url = format!("/video/{}", filename);

    tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("/app/scripts/generate-video.sh");
        cmd.arg(&audio_url);
        cmd.arg(cover_url.as_deref().unwrap_or(""));
        cmd.arg(&output_path);
        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    tracing::info!(uuid = %uuid, "Video generated: {}", filename);
                    // Save to DB in a new runtime context
                    let rt = tokio::runtime::Handle::current();
                    rt.block_on(async {
                        let _ = sqlx::query("UPDATE songs SET video_url = $1, video_token = $2 WHERE uuid = $3")
                            .bind(&video_url).bind(&token).bind(&uuid).execute(&db).await;
                    });
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    tracing::error!(uuid = %uuid, "Video generation failed: {}", stderr.trim());
                }
            }
            Err(e) => {
                tracing::error!(uuid = %uuid, "Failed to run generate-video.sh: {}", e);
            }
        }
    });
}

/// Generate a promo video for a song (admin only). Runs ffmpeg in background.
pub async fn generate_video(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    // Check if already exists in DB
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT video_url FROM songs WHERE uuid = $1 AND NOT is_deleted"
    ).bind(&uuid).fetch_optional(&state.db).await.ok().flatten();
    if let Some(url) = existing {
        return Ok(Json(serde_json::json!({ "status": "exists", "url": url })));
    }

    // Fetch song data
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT audio_url, cover_image_url FROM songs WHERE uuid = $1 AND NOT is_deleted",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let Some((audio_url, cover_url)) = row else {
        return Err((StatusCode::NOT_FOUND, "Song not found".to_string()));
    };

    spawn_video_generation(state.db.clone(), uuid, audio_url, cover_url);
    Ok(Json(serde_json::json!({ "status": "generating" })))
}

/// Generate video for premium users (any song that doesn't have video yet).
pub async fn generate_video_premium(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Auth required".to_string()))?;

    // Check premium
    let is_premium: bool = sqlx::query_scalar(
        "SELECT is_premium FROM users WHERE id = $1"
    ).bind(claims.user_id).fetch_one(&state.db).await.unwrap_or(false);
    if !is_premium {
        return Err((StatusCode::FORBIDDEN, "Premium required".to_string()));
    }

    // Check if already exists
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT video_url FROM songs WHERE uuid = $1 AND NOT is_deleted"
    ).bind(&uuid).fetch_optional(&state.db).await.ok().flatten();
    if let Some(url) = existing {
        return Ok(Json(serde_json::json!({ "status": "exists", "url": url })));
    }

    // Fetch song data
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT audio_url, cover_image_url FROM songs WHERE uuid = $1 AND NOT is_deleted",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let Some((audio_url, cover_url)) = row else {
        return Err((StatusCode::NOT_FOUND, "Song not found".to_string()));
    };

    spawn_video_generation(state.db.clone(), uuid, audio_url, cover_url);
    Ok(Json(serde_json::json!({ "status": "generating" })))
}

/// Delete a generated video (admin only).
pub async fn delete_video(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    // Delete from filesystem (both old and new format)
    let path = format!("{}/{}.mp4", VIDEO_DIR, uuid);
    let _ = std::fs::remove_file(&path);
    // Also try token-based filename
    let token: Option<String> = sqlx::query_scalar(
        "SELECT video_token FROM songs WHERE uuid = $1"
    ).bind(&uuid).fetch_optional(&state.db).await.ok().flatten();
    if let Some(t) = token {
        let path2 = format!("{}/{}_{}.mp4", VIDEO_DIR, uuid, t);
        let _ = std::fs::remove_file(&path2);
    }
    // Clear DB
    let _ = sqlx::query("UPDATE songs SET video_url = NULL, video_token = NULL WHERE uuid = $1")
        .bind(&uuid).execute(&state.db).await;

    Ok(Json(serde_json::json!({ "status": "deleted" })))
}
