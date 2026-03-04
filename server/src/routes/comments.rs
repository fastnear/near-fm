use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::{
    auth::jwt::{require_admin, require_auth},
    AppState,
};

// ── Types ──

#[derive(Debug, Serialize, FromRow)]
pub struct CommentRow {
    pub id: i32,
    pub body: String,
    pub is_hidden: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub author_account_id: String,
    pub author_display_name: Option<String>,
    pub author_avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCommentBody {
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct AdminCommentsQuery {
    pub search: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct AdminCommentRow {
    pub id: i32,
    pub body: String,
    pub is_hidden: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub author_account_id: String,
    pub author_display_name: Option<String>,
    pub song_uuid: String,
    pub song_title: String,
}

#[derive(Debug, Deserialize)]
pub struct ModerateCommentBody {
    pub is_hidden: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct MuteUserBody {
    pub is_muted: bool,
}

// ── Public endpoints ──

/// GET /api/songs/:uuid/comments
pub async fn list_comments(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
) -> Result<Json<Vec<CommentRow>>, (StatusCode, String)> {
    // Check if caller is admin (to show hidden comments)
    let is_admin = require_admin(&extensions).is_ok();

    let hidden_filter = if is_admin { "" } else { "AND c.is_hidden = FALSE" };

    let query = format!(
        r#"SELECT c.id, c.body, c.is_hidden, c.created_at,
                  u.slug AS author_account_id,
                  u.display_name AS author_display_name,
                  u.avatar_url AS author_avatar_url
           FROM comments c
           JOIN users u ON u.id = c.user_id
           JOIN songs s ON s.id = c.song_id
           WHERE s.uuid = $1 {}
           ORDER BY c.created_at ASC"#,
        hidden_filter
    );

    let comments = sqlx::query_as::<_, CommentRow>(&query)
        .bind(&uuid)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(comments))
}

/// POST /api/songs/:uuid/comments
pub async fn create_comment(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<CreateCommentBody>,
) -> Result<Json<CommentRow>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let body = req.body.trim().to_string();
    if body.is_empty() || body.len() > 2000 {
        return Err((StatusCode::BAD_REQUEST, "Comment must be 1-2000 characters".to_string()));
    }

    // Check if user is banned or muted
    let (is_banned, is_muted): (bool, bool) = sqlx::query_as(
        "SELECT is_banned, is_muted FROM users WHERE id = $1",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Your account has been banned".to_string()));
    }

    if is_muted {
        return Err((StatusCode::FORBIDDEN, "Your account has been muted".to_string()));
    }

    // Get song_id and uploader
    let song_row: Option<(i32, i32, String)> = sqlx::query_as(
        "SELECT id, uploader_id, title FROM songs WHERE uuid = $1"
    )
        .bind(&uuid)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (song_id, uploader_id, song_title) = song_row
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    // Insert comment
    let comment = sqlx::query_as::<_, CommentRow>(
        r#"INSERT INTO comments (song_id, user_id, body)
           VALUES ($1, $2, $3)
           RETURNING id, body, is_hidden, created_at,
                     (SELECT slug FROM users WHERE id = $2) AS author_account_id,
                     (SELECT display_name FROM users WHERE id = $2) AS author_display_name,
                     (SELECT avatar_url FROM users WHERE id = $2) AS author_avatar_url"#,
    )
    .bind(song_id)
    .bind(claims.user_id)
    .bind(&body)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Notify song uploader (don't notify yourself)
    if uploader_id != claims.user_id {
        let truncated_body: String = body.chars().take(97).collect();
        let truncated_body = if body.chars().count() > 100 {
            format!("{}...", truncated_body)
        } else {
            body.clone()
        };
        let message = format!(
            "{} commented on your song \"{}\": \"{}\"",
            claims.sub, song_title, truncated_body
        );
        let data = serde_json::json!({
            "message": message,
            "song_uuid": uuid,
            "song_title": song_title,
            "comment_id": comment.id,
            "commenter_account_id": claims.sub,
        });
        let _ = sqlx::query(
            r#"INSERT INTO notifications (user_id, type, data)
               VALUES ($1, 'comment', $2)"#,
        )
        .bind(uploader_id)
        .bind(&data)
        .execute(&state.db)
        .await;
    }

    Ok(Json(comment))
}

// ── Admin endpoints ──

/// GET /api/admin/comments
pub async fn admin_list_comments(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(query): Query<AdminCommentsQuery>,
) -> Result<Json<Vec<AdminCommentRow>>, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    let comments = if let Some(search) = &query.search {
        let pattern = format!("%{}%", search);
        sqlx::query_as::<_, AdminCommentRow>(
            r#"SELECT c.id, c.body, c.is_hidden, c.created_at,
                      u.slug AS author_account_id,
                      u.display_name AS author_display_name,
                      s.uuid AS song_uuid,
                      s.title AS song_title
               FROM comments c
               JOIN users u ON u.id = c.user_id
               JOIN songs s ON s.id = c.song_id
               WHERE c.body ILIKE $1 OR u.slug ILIKE $1
               ORDER BY c.created_at DESC
               LIMIT 100"#,
        )
        .bind(&pattern)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, AdminCommentRow>(
            r#"SELECT c.id, c.body, c.is_hidden, c.created_at,
                      u.slug AS author_account_id,
                      u.display_name AS author_display_name,
                      s.uuid AS song_uuid,
                      s.title AS song_title
               FROM comments c
               JOIN users u ON u.id = c.user_id
               JOIN songs s ON s.id = c.song_id
               ORDER BY c.created_at DESC
               LIMIT 100"#,
        )
        .fetch_all(&state.db)
        .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(comments))
}

/// PATCH /api/admin/comments/:id
pub async fn admin_moderate_comment(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    extensions: Extensions,
    Json(req): Json<ModerateCommentBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    if let Some(is_hidden) = req.is_hidden {
        sqlx::query("UPDATE comments SET is_hidden = $1 WHERE id = $2")
            .bind(is_hidden)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(StatusCode::OK)
}

/// PATCH /api/admin/users/:account_id/mute
pub async fn admin_toggle_mute(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
    Json(req): Json<MuteUserBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    require_admin(&extensions)
        .map_err(|s| (s, "Admin required".to_string()))?;

    sqlx::query("UPDATE users SET is_muted = $1 WHERE slug = $2")
        .bind(req.is_muted)
        .bind(&account_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::OK)
}
