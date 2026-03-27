use axum::{
    extract::{Path, Query, State},
    http::{header, Extensions, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::{self, require_auth},
    db::{models::SongWithUploader, queries},
    routes::auth::validate_slug,
    AppState,
};

#[derive(Debug, Serialize)]
pub struct UserProfileResponse {
    pub account_id: String, // slug (backward compat field name)
    pub near_account_id: Option<String>,
    pub solana_address: Option<String>,
    pub auth_provider: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub reputation_score: String,
    pub total_uploads: i32,
    pub total_tips_received_yocto: String,
    pub total_tips_sent_yocto: String,
    pub total_likes_given: i64,
    pub total_dislikes_given: i64,
    pub followers_count: i64,
    pub following_count: i64,
    pub active_bounties_count: i64,
    pub active_bounties_total_yocto: String,
    pub active_bounties_total_usd_cents: i64,
    pub bio: Option<String>,
    pub twitter_handle: Option<String>,
    pub is_premium: bool,
    pub is_agent: bool,
    pub premium_gifted_by: Option<PremiumGiftInfo>,
    pub created_at: String,
    pub songs: Vec<SongWithUploader>,
}

#[derive(Debug, Serialize)]
pub struct PremiumGiftInfo {
    pub gifted_by_slug: String,
    pub gifted_by_display_name: Option<String>,
    pub days_added: i32,
    pub created_at: String,
}

pub async fn get_profile(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<UserProfileResponse>, (StatusCode, String)> {
    let user = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let songs = sqlx::query_as::<_, SongWithUploader>(
        r#"SELECT s.*,
            u.slug AS uploader_account_id,
                u.account_id AS uploader_near_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation,
            u.twitter_handle AS uploader_twitter_handle,
            u.is_agent AS uploader_is_agent,
            c.name AS category_name,
            c.slug AS category_slug,
            l.code AS language_code,
            l.name AS language_name,
            (SELECT COUNT(*) FROM comments cm WHERE cm.song_id = s.id AND NOT cm.is_hidden) AS comment_count,
            COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'slug', g.slug, 'display_order', g.display_order, 'created_at', g.created_at))::text FROM song_genres sg JOIN genres g ON g.id = sg.genre_id WHERE sg.song_id = s.id), '[]') AS genres_json
           FROM songs s
           JOIN users u ON s.uploader_id = u.id
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN languages l ON s.language_id = l.id
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

    let followers_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_follows WHERE followed_id = $1"
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let following_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_follows WHERE follower_id = $1"
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_tips_sent_yocto: String = sqlx::query_scalar(
        "SELECT COALESCE(SUM(CAST(amount_yocto AS NUMERIC)), 0)::TEXT FROM tips WHERE tipper_id = $1"
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or_else(|_| "0".to_string());

    let (active_bounties_count, active_bounties_total_yocto): (i64, String) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(CAST(bounty_amount_yocto AS NUMERIC)), 0)::TEXT FROM song_requests WHERE requester_id = $1 AND status = 'open'"
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, "0".to_string()));

    let active_bounties_total_usd_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(bounty_usd_cents), 0) FROM song_requests WHERE requester_id = $1 AND status = 'open' AND bounty_usd_cents IS NOT NULL"
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    // Last premium gift
    let premium_gifted_by: Option<PremiumGiftInfo> = sqlx::query_as::<_, (String, Option<String>, i32, chrono::DateTime<chrono::Utc>)>(
        r#"SELECT u.slug, u.display_name, pp.days_added, pp.created_at
           FROM premium_purchases pp
           JOIN users u ON pp.gifted_by_user_id = u.id
           WHERE pp.user_id = $1 AND pp.gifted_by_user_id IS NOT NULL
           ORDER BY pp.created_at DESC LIMIT 1"#,
    )
    .bind(user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|(slug, name, days, created)| PremiumGiftInfo {
        gifted_by_slug: slug,
        gifted_by_display_name: name,
        days_added: days,
        created_at: created.to_rfc3339(),
    });

    Ok(Json(UserProfileResponse {
        account_id: user.slug.clone(),
        near_account_id: user.account_id,
        solana_address: user.solana_address,
        auth_provider: user.auth_provider.clone(),
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        reputation_score: user.reputation_score.to_string(),
        total_uploads: user.total_uploads,
        total_tips_received_yocto: user.total_tips_received_yocto,
        total_tips_sent_yocto,
        total_likes_given,
        total_dislikes_given,
        followers_count,
        following_count,
        active_bounties_count,
        active_bounties_total_yocto,
        active_bounties_total_usd_cents,
        bio: user.bio,
        twitter_handle: user.twitter_handle,
        is_premium: user.premium_until.map_or(false, |u| u > chrono::Utc::now()),
        is_agent: user.is_agent,
        premium_gifted_by,
        created_at: user.created_at.to_rfc3339(),
        songs,
    }))
}

// Deprecated: bookmarks feature removed from UI
#[derive(Debug, Deserialize)]
pub struct BookmarkRequest {
    pub song_uuid: String,
}

// Deprecated: bookmarks feature removed from UI
#[allow(dead_code)]
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

// Deprecated: bookmarks feature removed from UI
#[allow(dead_code)]
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

// Deprecated: bookmarks feature removed from UI
#[allow(dead_code)]
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
            u.slug AS uploader_account_id,
                u.account_id AS uploader_near_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation,
            u.twitter_handle AS uploader_twitter_handle,
            u.is_agent AS uploader_is_agent,
            c.name AS category_name,
            c.slug AS category_slug,
            l.code AS language_code,
            l.name AS language_name,
            (SELECT COUNT(*) FROM comments cm WHERE cm.song_id = s.id AND NOT cm.is_hidden) AS comment_count,
            COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'slug', g.slug, 'display_order', g.display_order, 'created_at', g.created_at))::text FROM song_genres sg JOIN genres g ON g.id = sg.genre_id WHERE sg.song_id = s.id), '[]') AS genres_json
           FROM bookmarks b
           JOIN songs s ON b.song_id = s.id
           JOIN users u ON s.uploader_id = u.id
           LEFT JOIN categories c ON s.category_id = c.id
           LEFT JOIN languages l ON s.language_id = l.id
           WHERE b.user_id = $1 AND NOT s.is_deleted AND NOT s.is_hidden
           ORDER BY b.created_at DESC"#,
    )
    .bind(claims.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(songs))
}

// ── Follows ──

#[derive(Debug, Serialize)]
pub struct FollowStatusResponse {
    pub is_following: bool,
    pub followers_count: i64,
}

pub async fn follow_user(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
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

    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    if target.id == claims.user_id {
        return Err((StatusCode::BAD_REQUEST, "Cannot follow yourself".to_string()));
    }

    let result = sqlx::query(
        "INSERT INTO user_follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(claims.user_id)
    .bind(target.id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Notify the followed user (only if it was a new follow, not a duplicate)
    if result.rows_affected() > 0 {
        queries::create_notification(
            &state.db,
            target.id,
            "new_follower",
            &serde_json::json!({
                "follower_slug": claims.sub,
            }),
        )
        .await
        .ok();
    }

    Ok(StatusCode::CREATED)
}

pub async fn unfollow_user(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    sqlx::query("DELETE FROM user_follows WHERE follower_id = $1 AND followed_id = $2")
        .bind(claims.user_id)
        .bind(target.id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_follow_status(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
) -> Result<Json<FollowStatusResponse>, (StatusCode, String)> {
    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let followers_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_follows WHERE followed_id = $1"
    )
    .bind(target.id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let is_following = if let Some(claims) = extensions.get::<crate::auth::jwt::Claims>() {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $1 AND followed_id = $2)"
        )
        .bind(claims.user_id)
        .bind(target.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false)
    } else {
        false
    };

    Ok(Json(FollowStatusResponse {
        is_following,
        followers_count,
    }))
}

pub async fn list_followers(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<Vec<FollowerEntry>>, (StatusCode, String)> {
    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let followers: Vec<FollowerEntry> = sqlx::query_as(
        r#"SELECT u.slug AS account_id, u.display_name, u.avatar_url, uf.created_at
           FROM user_follows uf
           JOIN users u ON uf.follower_id = u.id
           WHERE uf.followed_id = $1
           ORDER BY uf.created_at DESC
           LIMIT 200"#,
    )
    .bind(target.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(followers))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct FollowerEntry {
    pub account_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ── Profile Update ──

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub avatar_url: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub twitter_handle: Option<String>,
    pub slug: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpdateProfileResponse {
    pub ok: bool,
    pub new_slug: Option<String>,
}

pub async fn update_profile(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub != account_id {
        return Err((StatusCode::FORBIDDEN, "Cannot edit another user's profile".to_string()));
    }

    let bio = req.bio.map(|b| {
        let trimmed: String = b.chars().take(256).collect();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    }).unwrap_or(None);
    let twitter = req.twitter_handle.map(|t| {
        let trimmed: String = t.trim_start_matches('@').chars().take(50).collect();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    }).unwrap_or(None);

    // Handle slug rename (Google users only)
    let mut new_slug: Option<String> = None;
    if let Some(ref requested_slug) = req.slug {
        let requested_slug = requested_slug.trim().to_lowercase();

        // Only allow rename if different from current
        if requested_slug != account_id {
            // Check auth_provider
            let auth_provider: String = sqlx::query_scalar(
                "SELECT auth_provider FROM users WHERE slug = $1"
            )
            .bind(&account_id)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if auth_provider != "google" {
                return Err((StatusCode::FORBIDDEN, "Only Google accounts can change username".to_string()));
            }

            validate_slug(&requested_slug)
                .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

            // Check uniqueness
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM users WHERE slug = $1)"
            )
            .bind(&requested_slug)
            .fetch_one(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            if exists {
                return Err((StatusCode::CONFLICT, "This username is already taken".to_string()));
            }

            sqlx::query("UPDATE users SET slug = $1, updated_at = NOW() WHERE slug = $2")
                .bind(&requested_slug)
                .bind(&account_id)
                .execute(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            new_slug = Some(requested_slug);
        }
    }

    // Sanitize display_name
    let display_name = req.display_name.as_deref().map(|n| {
        let trimmed: String = n.trim().chars().take(100).collect();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    }).unwrap_or(None);

    // Update other profile fields
    sqlx::query(
        r#"UPDATE users
           SET avatar_url = COALESCE($1, avatar_url),
               display_name = COALESCE($5, display_name),
               bio = $2,
               twitter_handle = $3,
               updated_at = NOW()
           WHERE slug = $4"#,
    )
    .bind(&req.avatar_url)
    .bind(&bio)
    .bind(&twitter)
    .bind(new_slug.as_deref().unwrap_or(&account_id))
    .bind(&display_name)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // If slug changed, issue new JWT with updated sub
    if let Some(ref slug) = new_slug {
        let token = jwt::create_token(&state.config.jwt_secret, slug, claims.user_id, claims.is_admin, claims.account_id.as_deref(), claims.solana_address.as_deref())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let cookie = super::auth::build_session_cookie(&token, &state.config.frontend_url);

        let body = serde_json::to_string(&UpdateProfileResponse {
            ok: true,
            new_slug: new_slug.clone(),
        }).unwrap();

        let response = axum::response::Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::SET_COOKIE, cookie)
            .body(axum::body::Body::from(body))
            .unwrap();

        return Ok(response.into_response());
    }

    let body = serde_json::to_string(&UpdateProfileResponse {
        ok: true,
        new_slug: None,
    }).unwrap();

    Ok(axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(body))
        .unwrap()
        .into_response())
}

// ── Feed Preferences ──

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedPreferencesResponse {
    pub excluded_genres: Vec<i32>,
    pub excluded_languages: Vec<i32>,
    pub excluded_categories: Vec<i32>,
    #[serde(default)]
    pub hide_no_cover: bool,
}

pub async fn get_feed_preferences(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
) -> Result<Json<FeedPreferencesResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub != account_id {
        return Err((StatusCode::FORBIDDEN, "Cannot view another user's preferences".to_string()));
    }

    let rows: Vec<(String, i32)> = sqlx::query_as(
        "SELECT exclusion_type, exclusion_id FROM user_feed_exclusions WHERE user_id = $1"
    )
    .bind(claims.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut excluded_genres = Vec::new();
    let mut excluded_languages = Vec::new();
    let mut excluded_categories = Vec::new();
    let mut hide_no_cover = false;

    for (t, id) in rows {
        match t.as_str() {
            "genre" => excluded_genres.push(id),
            "language" => excluded_languages.push(id),
            "category" => excluded_categories.push(id),
            "no_cover" => hide_no_cover = true,
            _ => {}
        }
    }

    Ok(Json(FeedPreferencesResponse {
        excluded_genres,
        excluded_languages,
        excluded_categories,
        hide_no_cover,
    }))
}

pub async fn update_feed_preferences(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
    Json(req): Json<FeedPreferencesResponse>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub != account_id {
        return Err((StatusCode::FORBIDDEN, "Cannot modify another user's preferences".to_string()));
    }

    // Delete all existing exclusions
    sqlx::query("DELETE FROM user_feed_exclusions WHERE user_id = $1")
        .bind(claims.user_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Insert new exclusions
    for id in &req.excluded_genres {
        sqlx::query("INSERT INTO user_feed_exclusions (user_id, exclusion_type, exclusion_id) VALUES ($1, 'genre', $2) ON CONFLICT DO NOTHING")
            .bind(claims.user_id)
            .bind(id)
            .execute(&state.db)
            .await
            .ok();
    }
    for id in &req.excluded_languages {
        sqlx::query("INSERT INTO user_feed_exclusions (user_id, exclusion_type, exclusion_id) VALUES ($1, 'language', $2) ON CONFLICT DO NOTHING")
            .bind(claims.user_id)
            .bind(id)
            .execute(&state.db)
            .await
            .ok();
    }
    for id in &req.excluded_categories {
        sqlx::query("INSERT INTO user_feed_exclusions (user_id, exclusion_type, exclusion_id) VALUES ($1, 'category', $2) ON CONFLICT DO NOTHING")
            .bind(claims.user_id)
            .bind(id)
            .execute(&state.db)
            .await
            .ok();
    }
    if req.hide_no_cover {
        sqlx::query("INSERT INTO user_feed_exclusions (user_id, exclusion_type, exclusion_id) VALUES ($1, 'no_cover', 1) ON CONFLICT DO NOTHING")
            .bind(claims.user_id)
            .execute(&state.db)
            .await
            .ok();
    }

    Ok(StatusCode::OK)
}

// ── User Blocks ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BlockedUserEntry {
    pub account_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

pub async fn block_user(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub == account_id {
        return Err((StatusCode::BAD_REQUEST, "Cannot block yourself".to_string()));
    }

    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    // Insert block
    sqlx::query(
        "INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(claims.user_id)
    .bind(target.id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Auto-unfollow in both directions
    sqlx::query("DELETE FROM user_follows WHERE (follower_id = $1 AND followed_id = $2) OR (follower_id = $2 AND followed_id = $1)")
        .bind(claims.user_id)
        .bind(target.id)
        .execute(&state.db)
        .await
        .ok();

    Ok(StatusCode::CREATED)
}

pub async fn unblock_user(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    sqlx::query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2")
        .bind(claims.user_id)
        .bind(target.id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_blocked_users(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
) -> Result<Json<Vec<BlockedUserEntry>>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if claims.sub != account_id {
        return Err((StatusCode::FORBIDDEN, "Cannot view another user's blocked list".to_string()));
    }

    let blocked: Vec<BlockedUserEntry> = sqlx::query_as(
        r#"SELECT u.slug AS account_id, u.display_name, u.avatar_url
           FROM user_blocks ub
           JOIN users u ON ub.blocked_id = u.id
           WHERE ub.blocker_id = $1
           ORDER BY ub.created_at DESC"#,
    )
    .bind(claims.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(blocked))
}

// ── Profile Comments (fan feed / guestbook) ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ProfileCommentRow {
    pub id: i32,
    pub body: String,
    pub is_hidden: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub author_account_id: String,
    pub author_display_name: Option<String>,
    pub author_avatar_url: Option<String>,
    pub author_is_premium: bool,
    pub author_is_agent: bool,
    pub amount_yocto: Option<String>,
    pub reply_count: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreateProfileCommentBody {
    pub body: String,
}

/// GET /api/users/:account_id/comments
pub async fn list_profile_comments(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<Vec<ProfileCommentRow>>, (StatusCode, String)> {
    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let comments = sqlx::query_as::<_, ProfileCommentRow>(
        r#"SELECT pc.id, pc.body, pc.is_hidden, pc.created_at,
                  u.slug AS author_account_id,
                  u.display_name AS author_display_name,
                  u.avatar_url AS author_avatar_url,
                  COALESCE(u.premium_until > NOW(), FALSE) AS author_is_premium,
                  u.is_agent AS author_is_agent,
                  pc.amount_yocto,
                  COALESCE(rc.reply_count, 0) AS reply_count
           FROM profile_comments pc
           JOIN users u ON u.id = pc.author_user_id
           LEFT JOIN (
               SELECT parent_id, COUNT(*) AS reply_count
               FROM post_replies
               WHERE parent_type = 'profile_comment' AND NOT is_hidden
                 AND parent_id IN (SELECT id FROM profile_comments WHERE profile_user_id = $1 AND NOT is_hidden)
               GROUP BY parent_id
           ) rc ON rc.parent_id = pc.id
           WHERE pc.profile_user_id = $1 AND NOT pc.is_hidden
           ORDER BY pc.created_at DESC
           LIMIT 100"#,
    )
    .bind(target.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(comments))
}

/// POST /api/users/:account_id/comments
pub async fn create_profile_comment(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
    Json(req): Json<CreateProfileCommentBody>,
) -> Result<Json<ProfileCommentRow>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let body = req.body.trim().to_string();
    if body.is_empty() || body.chars().count() > 1000 {
        return Err((StatusCode::BAD_REQUEST, "Comment must be 1-1000 characters".to_string()));
    }

    // Check if commenter is banned or muted
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

    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    // Limit comments per author per profile to prevent spam
    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM profile_comments WHERE profile_user_id = $1 AND author_user_id = $2",
    )
    .bind(target.id)
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing >= 10 {
        return Err((StatusCode::TOO_MANY_REQUESTS, "Maximum 10 comments per profile".to_string()));
    }

    let comment = sqlx::query_as::<_, ProfileCommentRow>(
        r#"INSERT INTO profile_comments (profile_user_id, author_user_id, body)
           VALUES ($1, $2, $3)
           RETURNING id, body, is_hidden, created_at,
                     (SELECT slug FROM users WHERE id = $2) AS author_account_id,
                     (SELECT display_name FROM users WHERE id = $2) AS author_display_name,
                     (SELECT avatar_url FROM users WHERE id = $2) AS author_avatar_url,
                     COALESCE((SELECT premium_until > NOW() FROM users WHERE id = $2), FALSE) AS author_is_premium,
                     (SELECT is_agent FROM users WHERE id = $2) AS author_is_agent,
                     NULL::TEXT AS amount_yocto,
                     0::BIGINT AS reply_count"#,
    )
    .bind(target.id)
    .bind(claims.user_id)
    .bind(&body)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Notify the profile owner (don't notify yourself)
    if target.id != claims.user_id {
        let _ = sqlx::query(
            r#"INSERT INTO notifications (user_id, type, data)
               VALUES ($1, 'profile_comment', $2)"#,
        )
        .bind(target.id)
        .bind(serde_json::json!({
            "message": format!("{} left a comment on your profile", claims.sub),
            "commenter_account_id": claims.sub,
            "comment_id": comment.id,
        }))
        .execute(&state.db)
        .await;
    }

    Ok(Json(comment))
}

/// DELETE /api/users/:account_id/comments/:id
pub async fn delete_profile_comment(
    State(state): State<AppState>,
    Path((account_id, id)): Path<(String, i32)>,
    extensions: Extensions,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Author or profile owner or admin can delete
    let row: Option<(i32, i32)> = sqlx::query_as(
        r#"SELECT pc.author_user_id, pc.profile_user_id
           FROM profile_comments pc
           JOIN users pu ON pu.id = pc.profile_user_id
           WHERE pc.id = $1 AND pu.slug = $2"#,
    )
    .bind(id)
    .bind(&account_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (author_user_id, profile_user_id) = row
        .ok_or((StatusCode::NOT_FOUND, "Comment not found".to_string()))?;

    if author_user_id != claims.user_id && profile_user_id != claims.user_id && !claims.is_admin {
        return Err((StatusCode::FORBIDDEN, "Not authorized to delete this comment".to_string()));
    }

    // Delete replies first, then the comment itself (in a transaction)
    let mut tx = state.db.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM post_replies WHERE parent_type = 'profile_comment' AND parent_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM profile_comments WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── Profile Tips ──

/// Minimum profile tip: 0.1 NEAR in yoctoNEAR
const MIN_PROFILE_TIP_YOCTO: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR

#[derive(Debug, Deserialize)]
pub struct RecordProfileTipRequest {
    pub tx_hash: String,
    pub amount_yocto: String,
    pub from_balance: bool,
    pub body: Option<String>,
}

/// POST /api/users/:account_id/tip
pub async fn record_profile_tip(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    extensions: Extensions,
    Json(req): Json<RecordProfileTipRequest>,
) -> Result<Json<ProfileCommentRow>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Check if tipper is banned
    let is_banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Your account has been banned".to_string()));
    }

    // Validate amount
    let req_amount: u128 = req.amount_yocto.parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid amount_yocto".to_string()))?;
    if req_amount < MIN_PROFILE_TIP_YOCTO {
        return Err((StatusCode::BAD_REQUEST, "Minimum tip is 0.1 NEAR".to_string()));
    }

    // Require a linked NEAR wallet
    let near_account = claims.account_id.as_deref()
        .or_else(|| {
            if claims.sub.contains('.') { Some(claims.sub.as_str()) } else { None }
        })
        .ok_or_else(|| (StatusCode::FORBIDDEN, "Connect a NEAR wallet to send tips".to_string()))?
        .to_string();

    // Verify transaction on-chain
    let verified = crate::near::tx_verify::verify_near_tx(
        &state.config.near_rpc_url,
        &req.tx_hash,
        &near_account,
    )
    .await
    .map_err(|e| {
        tracing::warn!("Profile tip TX verification failed for {}: {}", req.tx_hash, e);
        (StatusCode::BAD_REQUEST, format!("Transaction verification failed: {}", e))
    })?;

    let expected_method = if req.from_balance { "tip_from_balance" } else { "tip" };
    if verified.method_name != expected_method {
        return Err((StatusCode::BAD_REQUEST, format!(
            "Wrong contract method: expected {}, got {}", expected_method, verified.method_name
        )));
    }
    if verified.receiver_id != state.config.contract_id {
        return Err((StatusCode::BAD_REQUEST, "Transaction sent to wrong contract".to_string()));
    }
    // Reject song-tip transactions (song_uuid must be absent or empty for profile tips)
    if verified.args_json["song_uuid"].as_str().is_some_and(|s| !s.is_empty()) {
        return Err((StatusCode::BAD_REQUEST, "Transaction was intended for a song tip".to_string()));
    }

    // Use on-chain amount
    let amount_yocto = if req.from_balance {
        verified.args_json["amount"]
            .as_str()
            .ok_or((StatusCode::BAD_REQUEST, "Missing amount in balance tip args".to_string()))?
            .to_string()
    } else {
        verified.deposit.clone()
    };

    // Re-validate verified on-chain amount against minimum
    let verified_req_amount: u128 = amount_yocto.parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid on-chain amount".to_string()))?;
    if verified_req_amount < MIN_PROFILE_TIP_YOCTO {
        return Err((StatusCode::BAD_REQUEST, "Minimum tip is 0.1 NEAR".to_string()));
    }

    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    // Require profile owner to have a linked NEAR wallet, and verify TX recipient matches
    let target_near = target.account_id.as_deref()
        .ok_or((StatusCode::BAD_REQUEST, "This artist hasn't linked a NEAR wallet".to_string()))?;
    let tx_recipient = verified.args_json["recipient"]
        .as_str()
        .ok_or((StatusCode::BAD_REQUEST, "Missing recipient in transaction args".to_string()))?;
    if tx_recipient != target_near {
        return Err((StatusCode::BAD_REQUEST, "Transaction recipient does not match profile owner".to_string()));
    }

    let body = req.body
        .map(|b| {
            let t = b.trim().to_string();
            if t.chars().count() > 500 { t.chars().take(500).collect() } else { t }
        })
        .unwrap_or_default();

    // Insert profile comment with tip amount (tx_hash unique prevents double-recording)
    let comment = sqlx::query_as::<_, ProfileCommentRow>(
        r#"INSERT INTO profile_comments (profile_user_id, author_user_id, body, amount_yocto, tx_hash)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, body, is_hidden, created_at,
                     (SELECT slug FROM users WHERE id = $2) AS author_account_id,
                     (SELECT display_name FROM users WHERE id = $2) AS author_display_name,
                     (SELECT avatar_url FROM users WHERE id = $2) AS author_avatar_url,
                     COALESCE((SELECT premium_until > NOW() FROM users WHERE id = $2), FALSE) AS author_is_premium,
                     (SELECT is_agent FROM users WHERE id = $2) AS author_is_agent,
                     amount_yocto,
                     0::BIGINT AS reply_count"#,
    )
    .bind(target.id)
    .bind(claims.user_id)
    .bind(&body)
    .bind(&amount_yocto)
    .bind(&req.tx_hash)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if e.to_string().contains("profile_comments_tx_hash_key") {
            (StatusCode::CONFLICT, "This transaction has already been recorded".to_string())
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    })?;

    // Update recipient's total tips received
    sqlx::query(
        r#"UPDATE users SET
            total_tips_received_yocto = (
                CAST(total_tips_received_yocto AS NUMERIC) + CAST($1 AS NUMERIC)
            )::TEXT
           WHERE id = $2"#,
    )
    .bind(&amount_yocto)
    .bind(target.id)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(
            user_id = target.id,
            amount = %amount_yocto,
            error = %e,
            "Failed to update total_tips_received_yocto"
        )
    })
    .ok();

    // Notify the profile owner (skip self-tips)
    if target.id != claims.user_id {
        let near_str = format!("{:.2}", verified_req_amount as f64 / 1e24);
        let _ = sqlx::query(
            r#"INSERT INTO notifications (user_id, type, data)
               VALUES ($1, 'profile_tip', $2)"#,
        )
        .bind(target.id)
        .bind(serde_json::json!({
            "message": format!("{} sent you {} NEAR", claims.sub, near_str),
            "from_account": claims.sub,
            "amount_yocto": amount_yocto,
        }))
        .execute(&state.db)
        .await;
    }

    Ok(Json(comment))
}

// ── Premium gifts received by user ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PremiumGiftEntry {
    pub id: i32,
    pub gifted_by_slug: String,
    pub gifted_by_display_name: Option<String>,
    pub gifted_by_avatar_url: Option<String>,
    pub days_added: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_premium_gifts(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<Vec<PremiumGiftEntry>>, (StatusCode, String)> {
    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let gifts: Vec<PremiumGiftEntry> = sqlx::query_as(
        r#"SELECT pp.id, u.slug AS gifted_by_slug, u.display_name AS gifted_by_display_name,
                  u.avatar_url AS gifted_by_avatar_url, pp.days_added, pp.created_at
           FROM premium_purchases pp
           JOIN users u ON pp.gifted_by_user_id = u.id
           WHERE pp.user_id = $1 AND pp.gifted_by_user_id IS NOT NULL
           ORDER BY pp.created_at DESC
           LIMIT 50"#,
    )
    .bind(target.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(gifts))
}

// ── Song tips received by user ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SongTipEntry {
    pub id: i32,
    pub song_uuid: Option<String>,
    pub song_title: Option<String>,
    pub song_cover_image_url: Option<String>,
    pub tipper_slug: String,
    pub tipper_display_name: Option<String>,
    pub tipper_avatar_url: Option<String>,
    pub amount_yocto: Option<String>,
    pub amount_usd_cents: Option<i32>,
    pub payment_method: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_song_tips(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<Vec<SongTipEntry>>, (StatusCode, String)> {
    let target = queries::get_user_by_slug(&state.db, &account_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;

    let tips: Vec<SongTipEntry> = sqlx::query_as(
        r#"SELECT t.id, s.uuid AS song_uuid, s.title AS song_title, s.cover_image_url AS song_cover_image_url,
                  u.slug AS tipper_slug, u.display_name AS tipper_display_name, u.avatar_url AS tipper_avatar_url,
                  t.amount_yocto, t.amount_usd_cents, t.payment_method, t.created_at
           FROM tips t
           LEFT JOIN songs s ON t.song_id = s.id
           JOIN users u ON t.tipper_id = u.id
           WHERE t.recipient_id = $1
           ORDER BY t.created_at DESC
           LIMIT 100"#,
    )
    .bind(target.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(tips))
}
