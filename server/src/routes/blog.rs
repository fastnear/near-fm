use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::require_auth,
    db::queries,
    AppState,
};

// ── Blog Posts ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BlogPostRow {
    pub id: i32,
    pub body: String,
    pub is_hidden: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub author_account_id: String,
    pub author_display_name: Option<String>,
    pub author_avatar_url: Option<String>,
    pub author_is_premium: bool,
    pub author_is_agent: bool,
    pub reply_count: i64,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBlogPostBody {
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateBlogPostBody {
    pub body: String,
}

/// GET /api/users/:slug/blog
pub async fn list_blog_posts(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Vec<BlogPostRow>>, (StatusCode, String)> {
    let target = queries::get_user_by_slug(&state.db, &slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let posts = sqlx::query_as::<_, BlogPostRow>(
        r#"SELECT bp.id, bp.body, bp.is_hidden, bp.created_at,
                  u.slug AS author_account_id,
                  u.display_name AS author_display_name,
                  u.avatar_url AS author_avatar_url,
                  COALESCE(u.premium_until > NOW(), FALSE) AS author_is_premium,
                  u.is_agent AS author_is_agent,
                  COALESCE(rc.reply_count, 0) AS reply_count,
                  bp.updated_at
           FROM blog_posts bp
           JOIN users u ON u.id = bp.author_user_id
           LEFT JOIN (
               SELECT parent_id, COUNT(*) AS reply_count
               FROM post_replies
               WHERE parent_type = 'blog_post' AND NOT is_hidden
                 AND parent_id IN (SELECT id FROM blog_posts WHERE author_user_id = $1 AND NOT is_hidden)
               GROUP BY parent_id
           ) rc ON rc.parent_id = bp.id
           WHERE bp.author_user_id = $1 AND NOT bp.is_hidden
           ORDER BY bp.created_at DESC
           LIMIT 100"#,
    )
    .bind(target.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(posts))
}

/// GET /api/users/:slug/blog/:id
pub async fn get_blog_post(
    State(state): State<AppState>,
    Path((slug, post_id)): Path<(String, i32)>,
) -> Result<Json<BlogPostRow>, (StatusCode, String)> {
    let target = queries::get_user_by_slug(&state.db, &slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let post = sqlx::query_as::<_, BlogPostRow>(
        r#"SELECT bp.id, bp.body, bp.is_hidden, bp.created_at,
                  u.slug AS author_account_id,
                  u.display_name AS author_display_name,
                  u.avatar_url AS author_avatar_url,
                  COALESCE(u.premium_until > NOW(), FALSE) AS author_is_premium,
                  u.is_agent AS author_is_agent,
                  COALESCE(rc.cnt, 0) AS reply_count,
                  bp.updated_at
           FROM blog_posts bp
           JOIN users u ON u.id = bp.author_user_id
           LEFT JOIN LATERAL (
               SELECT COUNT(*) AS cnt FROM post_replies pr
               WHERE pr.parent_type = 'blog_post' AND pr.parent_id = bp.id AND NOT pr.is_hidden
           ) rc ON TRUE
           WHERE bp.id = $1 AND bp.author_user_id = $2 AND NOT bp.is_hidden"#,
    )
    .bind(post_id)
    .bind(target.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Post not found".to_string()))?;

    Ok(Json(post))
}

/// POST /api/users/:slug/blog
pub async fn create_blog_post(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    extensions: Extensions,
    Json(req): Json<CreateBlogPostBody>,
) -> Result<Json<BlogPostRow>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let body = req.body.trim().to_string();
    if body.is_empty() || body.chars().count() > 5000 {
        return Err((StatusCode::BAD_REQUEST, "Post must be 1-5000 characters".to_string()));
    }

    // Check if user is banned
    let is_banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Your account has been banned".to_string()));
    }

    // Only the profile owner or admin can post
    let target = queries::get_user_by_slug(&state.db, &slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    if target.id != claims.user_id && !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Only the profile owner can create blog posts".to_string()));
    }

    // Rate limit: max 20 posts per hour
    let recent_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM blog_posts WHERE author_user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'",
    )
    .bind(target.id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if recent_count >= 20 {
        return Err((StatusCode::TOO_MANY_REQUESTS, "Too many posts. Please wait before posting again.".to_string()));
    }

    let post = sqlx::query_as::<_, BlogPostRow>(
        r#"INSERT INTO blog_posts (author_user_id, body)
           VALUES ($1, $2)
           RETURNING id, body, is_hidden, created_at,
                     (SELECT slug FROM users WHERE id = $1) AS author_account_id,
                     (SELECT display_name FROM users WHERE id = $1) AS author_display_name,
                     (SELECT avatar_url FROM users WHERE id = $1) AS author_avatar_url,
                     COALESCE((SELECT premium_until > NOW() FROM users WHERE id = $1), FALSE) AS author_is_premium,
                     (SELECT is_agent FROM users WHERE id = $1) AS author_is_agent,
                     0::BIGINT AS reply_count,
                     NULL::TIMESTAMPTZ AS updated_at"#,
    )
    .bind(target.id)
    .bind(&body)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Notify followers about new blog post
    let followers: Vec<(i32,)> = sqlx::query_as(
        "SELECT follower_id FROM user_follows WHERE followed_id = $1",
    )
    .bind(target.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let author_name = post.author_display_name.as_deref().unwrap_or(&claims.sub);
    let notif_data = serde_json::json!({
        "message": format!("{} published a new post", author_name),
        "author_slug": claims.sub,
        "author_display_name": post.author_display_name,
        "post_id": post.id,
    });
    for (fid,) in followers {
        let _ = sqlx::query(
            "INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)",
        )
        .bind(fid)
        .bind("blog_post")
        .bind(&notif_data)
        .execute(&state.db)
        .await;
    }

    Ok(Json(post))
}

/// PATCH /api/users/:slug/blog/:id
pub async fn update_blog_post(
    State(state): State<AppState>,
    Path((slug, post_id)): Path<(String, i32)>,
    extensions: Extensions,
    Json(req): Json<UpdateBlogPostBody>,
) -> Result<Json<BlogPostRow>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let body = req.body.trim().to_string();
    if body.is_empty() || body.chars().count() > 5000 {
        return Err((StatusCode::BAD_REQUEST, "Post must be 1-5000 characters".to_string()));
    }

    let target = queries::get_user_by_slug(&state.db, &slug)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    // Only author or admin
    let author_id: Option<i32> = sqlx::query_scalar(
        "SELECT author_user_id FROM blog_posts WHERE id = $1 AND author_user_id = $2",
    )
    .bind(post_id)
    .bind(target.id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if author_id.is_none() {
        return Err((StatusCode::NOT_FOUND, "Post not found".to_string()));
    }
    if target.id != claims.user_id && !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Not authorized to edit this post".to_string()));
    }

    let post = sqlx::query_as::<_, BlogPostRow>(
        r#"UPDATE blog_posts SET body = $1, updated_at = NOW() WHERE id = $2
           RETURNING id, body, is_hidden, created_at,
                     (SELECT slug FROM users WHERE id = author_user_id) AS author_account_id,
                     (SELECT display_name FROM users WHERE id = author_user_id) AS author_display_name,
                     (SELECT avatar_url FROM users WHERE id = author_user_id) AS author_avatar_url,
                     COALESCE((SELECT premium_until > NOW() FROM users WHERE id = author_user_id), FALSE) AS author_is_premium,
                     (SELECT is_agent FROM users WHERE id = author_user_id) AS author_is_agent,
                     0::BIGINT AS reply_count,
                     updated_at"#,
    )
    .bind(&body)
    .bind(post_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(post))
}

/// DELETE /api/users/:slug/blog/:id
pub async fn delete_blog_post(
    State(state): State<AppState>,
    Path((slug, post_id)): Path<(String, i32)>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let row: Option<(i32,)> = sqlx::query_as(
        r#"SELECT bp.author_user_id
           FROM blog_posts bp
           JOIN users u ON u.id = bp.author_user_id
           WHERE bp.id = $1 AND u.slug = $2"#,
    )
    .bind(post_id)
    .bind(&slug)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (author_user_id,) = row
        .ok_or((StatusCode::NOT_FOUND, "Post not found".to_string()))?;

    if author_user_id != claims.user_id && !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Not authorized to delete this post".to_string()));
    }

    // Delete replies first, then post (atomic transaction)
    let mut tx = state.db.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM post_replies WHERE parent_type = 'blog_post' AND parent_id = $1")
        .bind(post_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM blog_posts WHERE id = $1")
        .bind(post_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── Community Feed ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CommunityFeedItem {
    pub id: i32,
    pub item_type: String,
    pub body: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub author_account_id: String,
    pub author_display_name: Option<String>,
    pub author_avatar_url: Option<String>,
    pub author_is_premium: bool,
    pub author_is_agent: bool,
    pub song_uuid: Option<String>,
    pub song_title: Option<String>,
    pub song_cover_image_url: Option<String>,
    pub reply_count: Option<i64>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    pub blog_post_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CommunityFeedQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

/// GET /api/feed/community
pub async fn community_feed(
    State(state): State<AppState>,
    Query(params): Query<CommunityFeedQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let page = params.page.unwrap_or(1).max(1);
    let limit = params.limit.unwrap_or(24).clamp(1, 100);
    let offset = (page - 1) * limit;

    let items = sqlx::query_as::<_, CommunityFeedItem>(
        r#"(SELECT bp.id, 'blog_post' AS item_type, bp.body, bp.created_at,
                  u.slug AS author_account_id, u.display_name AS author_display_name,
                  u.avatar_url AS author_avatar_url,
                  COALESCE(u.premium_until > NOW(), FALSE) AS author_is_premium,
                  u.is_agent AS author_is_agent,
                  NULL::TEXT AS song_uuid, NULL::TEXT AS song_title, NULL::TEXT AS song_cover_image_url,
                  COALESCE(rc.reply_count, 0) AS reply_count,
                  bp.updated_at,
                  bp.id AS blog_post_id
           FROM blog_posts bp
           JOIN users u ON u.id = bp.author_user_id
           LEFT JOIN (
               SELECT parent_id, COUNT(*) AS reply_count
               FROM post_replies
               WHERE parent_type = 'blog_post' AND NOT is_hidden
               GROUP BY parent_id
           ) rc ON rc.parent_id = bp.id
           WHERE NOT bp.is_hidden)
        UNION ALL
        (SELECT c.id, 'song_comment' AS item_type, c.body, c.created_at,
                u.slug AS author_account_id, u.display_name AS author_display_name,
                u.avatar_url AS author_avatar_url,
                COALESCE(u.premium_until > NOW(), FALSE) AS author_is_premium,
                u.is_agent AS author_is_agent,
                s.uuid AS song_uuid, s.title AS song_title, s.cover_image_url AS song_cover_image_url,
                NULL::BIGINT AS reply_count, NULL::TIMESTAMPTZ AS updated_at, NULL::INT AS blog_post_id
         FROM comments c JOIN users u ON u.id = c.user_id
         JOIN songs s ON s.id = c.song_id
         WHERE NOT c.is_hidden AND NOT s.is_hidden AND NOT s.is_deleted)
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2"#,
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({
        "items": items,
        "page": page,
        "limit": limit,
    })))
}

// ── Post Replies (shared for blog_post and profile_comment) ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PostReplyRow {
    pub id: i32,
    pub parent_type: String,
    pub parent_id: i32,
    pub body: String,
    pub is_hidden: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub author_account_id: String,
    pub author_display_name: Option<String>,
    pub author_avatar_url: Option<String>,
    pub author_is_premium: bool,
    pub author_is_agent: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateReplyBody {
    pub body: String,
}

/// GET /api/posts/:parent_type/:parent_id/replies
pub async fn list_replies(
    State(state): State<AppState>,
    Path((parent_type, parent_id)): Path<(String, i32)>,
) -> Result<Json<Vec<PostReplyRow>>, (StatusCode, String)> {
    if parent_type != "blog_post" && parent_type != "profile_comment" {
        return Err((StatusCode::BAD_REQUEST, "Invalid parent_type".to_string()));
    }

    let replies = sqlx::query_as::<_, PostReplyRow>(
        r#"SELECT pr.id, pr.parent_type, pr.parent_id, pr.body, pr.is_hidden, pr.created_at,
                  u.slug AS author_account_id,
                  u.display_name AS author_display_name,
                  u.avatar_url AS author_avatar_url,
                  COALESCE(u.premium_until > NOW(), FALSE) AS author_is_premium,
                  u.is_agent AS author_is_agent
           FROM post_replies pr
           JOIN users u ON u.id = pr.author_user_id
           WHERE pr.parent_type = $1 AND pr.parent_id = $2 AND NOT pr.is_hidden
           ORDER BY pr.created_at ASC
           LIMIT 100"#,
    )
    .bind(&parent_type)
    .bind(parent_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(replies))
}

/// POST /api/posts/:parent_type/:parent_id/replies
pub async fn create_reply(
    State(state): State<AppState>,
    Path((parent_type, parent_id)): Path<(String, i32)>,
    extensions: Extensions,
    Json(req): Json<CreateReplyBody>,
) -> Result<Json<PostReplyRow>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if parent_type != "blog_post" && parent_type != "profile_comment" {
        return Err((StatusCode::BAD_REQUEST, "Invalid parent_type".to_string()));
    }

    let body = req.body.trim().to_string();
    if body.is_empty() || body.chars().count() > 1000 {
        return Err((StatusCode::BAD_REQUEST, "Reply must be 1-1000 characters".to_string()));
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

    // Verify parent exists
    let parent_exists: bool = match parent_type.as_str() {
        "blog_post" => {
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM blog_posts WHERE id = $1 AND NOT is_hidden)")
                .bind(parent_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        }
        "profile_comment" => {
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profile_comments WHERE id = $1 AND NOT is_hidden)")
                .bind(parent_id)
                .fetch_one(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        }
        _ => false,
    };

    if !parent_exists {
        return Err((StatusCode::NOT_FOUND, "Parent not found".to_string()));
    }

    // Rate limit: max 30 replies per hour per user
    let recent_replies: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM post_replies WHERE author_user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if recent_replies >= 30 {
        return Err((StatusCode::TOO_MANY_REQUESTS, "Too many replies. Please wait before replying again.".to_string()));
    }

    let reply = sqlx::query_as::<_, PostReplyRow>(
        r#"INSERT INTO post_replies (parent_type, parent_id, author_user_id, body)
           VALUES ($1, $2, $3, $4)
           RETURNING id, parent_type, parent_id, body, is_hidden, created_at,
                     (SELECT slug FROM users WHERE id = $3) AS author_account_id,
                     (SELECT display_name FROM users WHERE id = $3) AS author_display_name,
                     (SELECT avatar_url FROM users WHERE id = $3) AS author_avatar_url,
                     COALESCE((SELECT premium_until > NOW() FROM users WHERE id = $3), FALSE) AS author_is_premium,
                     (SELECT is_agent FROM users WHERE id = $3) AS author_is_agent"#,
    )
    .bind(&parent_type)
    .bind(parent_id)
    .bind(claims.user_id)
    .bind(&body)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Notify parent author
    let parent_author_id: Option<i32> = match parent_type.as_str() {
        "blog_post" => {
            sqlx::query_scalar("SELECT author_user_id FROM blog_posts WHERE id = $1")
                .bind(parent_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
        }
        "profile_comment" => {
            sqlx::query_scalar("SELECT author_user_id FROM profile_comments WHERE id = $1")
                .bind(parent_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
        }
        _ => None,
    };

    if let Some(author_id) = parent_author_id {
        if author_id != claims.user_id {
            let _ = sqlx::query(
                r#"INSERT INTO notifications (user_id, type, data)
                   VALUES ($1, 'reply', $2)"#,
            )
            .bind(author_id)
            .bind(serde_json::json!({
                "message": format!("{} replied to your {}", claims.sub, parent_type.replace('_', " ")),
                "from_account": claims.sub,
                "parent_type": parent_type,
                "parent_id": parent_id,
            }))
            .execute(&state.db)
            .await;
        }
    }

    Ok(Json(reply))
}

/// DELETE /api/replies/:id
pub async fn delete_reply(
    State(state): State<AppState>,
    Path(reply_id): Path<i32>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Fetch reply + parent author to allow parent owner to moderate
    let row: Option<(i32, String, i32)> = sqlx::query_as(
        "SELECT author_user_id, parent_type, parent_id FROM post_replies WHERE id = $1",
    )
    .bind(reply_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (reply_author_id, parent_type, parent_id) = row
        .ok_or((StatusCode::NOT_FOUND, "Reply not found".to_string()))?;

    // Check if current user is the parent content owner
    let is_parent_owner = match parent_type.as_str() {
        "blog_post" => {
            sqlx::query_scalar::<_, i32>("SELECT author_user_id FROM blog_posts WHERE id = $1")
                .bind(parent_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .map(|id| id == claims.user_id)
                .unwrap_or(false)
        }
        "profile_comment" => {
            sqlx::query_scalar::<_, i32>("SELECT author_user_id FROM profile_comments WHERE id = $1")
                .bind(parent_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .map(|id| id == claims.user_id)
                .unwrap_or(false)
        }
        _ => false,
    };

    if reply_author_id != claims.user_id && !is_parent_owner && !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Not authorized to delete this reply".to_string()));
    }

    sqlx::query("DELETE FROM post_replies WHERE id = $1")
        .bind(reply_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
