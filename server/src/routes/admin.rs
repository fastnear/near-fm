use axum::{
    extract::{Path, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::require_admin,
    db::models::{Category, Report, PlatformConfig},
    AppState,
};

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
                  u.account_id AS reporter_account_id
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
    pub is_hidden: Option<bool>,
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
            updated_at = NOW()
           WHERE uuid = $3"#,
    )
    .bind(req.category_id)
    .bind(req.is_hidden)
    .bind(&uuid)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
