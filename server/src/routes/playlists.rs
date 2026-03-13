use axum::{
    extract::{Path, Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    auth::jwt::require_auth,
    db::models::{PlaylistWithCount, SongWithUploader},
    AppState,
};

const MAX_PLAYLISTS: i64 = 3; // excludes auto playlists

fn require_premium(premium_until: Option<chrono::DateTime<chrono::Utc>>) -> Result<(), (StatusCode, String)> {
    match premium_until {
        Some(until) if until > chrono::Utc::now() => Ok(()),
        _ => Err((StatusCode::FORBIDDEN, "Premium subscription required".to_string())),
    }
}

fn generate_feed_token() -> String {
    format!("{}-{}", uuid::Uuid::new_v4(), &uuid::Uuid::new_v4().to_string()[..12])
}

/// Ensure the auto "All My Songs" playlist exists for a premium user.
async fn ensure_auto_playlist(pool: &sqlx::PgPool, user_id: i32) -> Result<(), sqlx::Error> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM playlists WHERE user_id = $1 AND is_auto = TRUE)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if !exists {
        let uuid = uuid::Uuid::new_v4().to_string();
        let feed_token = generate_feed_token();
        let row = sqlx::query_as::<_, (Option<String>, Option<String>, String)>(
            "SELECT display_name, avatar_url, slug FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        let (display_name, avatar_url, slug) = row;
        let author = display_name.unwrap_or(slug);
        let name = format!("Tracks By {} on NEAR FM - AI Radio", author);
        sqlx::query(
            r#"INSERT INTO playlists (uuid, user_id, name, description, cover_image_url, feed_token, is_auto)
               VALUES ($1, $2, $3, 'Automatically includes all your uploaded songs', $4, $5, TRUE)"#,
        )
        .bind(&uuid)
        .bind(user_id)
        .bind(&name)
        .bind(&avatar_url)
        .bind(&feed_token)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ── List playlists ──

#[derive(Debug, Deserialize)]
pub struct ListPlaylistsQuery {
    pub song_uuid: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PlaylistWithMembership {
    #[serde(flatten)]
    pub playlist: PlaylistWithCount,
    pub contains_song: Option<bool>,
}

/// GET /api/playlists — list current user's playlists
pub async fn list_playlists(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(query): Query<ListPlaylistsQuery>,
) -> Result<Json<Vec<PlaylistWithMembership>>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Check premium and ensure auto playlist
    let user = sqlx::query_as::<_, crate::db::models::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if user.premium_until.map_or(false, |u| u > chrono::Utc::now()) {
        ensure_auto_playlist(&state.db, claims.user_id).await.ok();
    }

    let playlists = sqlx::query_as::<_, PlaylistWithCount>(
        r#"SELECT p.*, CASE
            WHEN p.is_auto THEN (SELECT COUNT(*) FROM songs s WHERE s.uploader_id = p.user_id AND NOT s.is_deleted AND NOT s.is_hidden AND s.is_validated)
            ELSE COALESCE((SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id), 0)
        END AS song_count
        FROM playlists p WHERE p.user_id = $1
        ORDER BY p.is_auto DESC, p.created_at DESC"#,
    )
    .bind(claims.user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // If song_uuid is provided, check membership for each playlist
    let result = if let Some(ref song_uuid) = query.song_uuid {
        let song = sqlx::query_as::<_, crate::db::models::Song>(
            "SELECT * FROM songs WHERE uuid = $1 AND NOT is_deleted",
        )
        .bind(song_uuid)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        if let Some(song) = song {
            let mut result = Vec::new();
            for pl in playlists {
                let contains = if pl.is_auto {
                    // Auto playlist contains all user's songs — check if this song is theirs
                    song.uploader_id == claims.user_id
                } else {
                    sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS(SELECT 1 FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2)",
                    )
                    .bind(pl.id)
                    .bind(song.id)
                    .fetch_one(&state.db)
                    .await
                    .unwrap_or(false)
                };
                result.push(PlaylistWithMembership {
                    playlist: pl,
                    contains_song: Some(contains),
                });
            }
            result
        } else {
            playlists.into_iter().map(|pl| PlaylistWithMembership { playlist: pl, contains_song: Some(false) }).collect()
        }
    } else {
        playlists.into_iter().map(|pl| PlaylistWithMembership { playlist: pl, contains_song: None }).collect()
    };

    Ok(Json(result))
}

// ── Create playlist ──

#[derive(Debug, Deserialize)]
pub struct CreatePlaylistRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PlaylistResponse {
    pub playlist: PlaylistWithCount,
}

/// POST /api/playlists — create a playlist (premium, max 3 non-auto)
pub async fn create_playlist(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let user = sqlx::query_as::<_, crate::db::models::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    require_premium(user.premium_until)?;

    // Count non-auto playlists only
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM playlists WHERE user_id = $1 AND NOT is_auto",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if count >= MAX_PLAYLISTS {
        return Err((StatusCode::BAD_REQUEST, format!("Maximum {} playlists allowed", MAX_PLAYLISTS)));
    }

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 200 {
        return Err((StatusCode::BAD_REQUEST, "Name must be 1-200 characters".to_string()));
    }

    let uuid = uuid::Uuid::new_v4().to_string();
    let feed_token = generate_feed_token();
    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        r#"INSERT INTO playlists (uuid, user_id, name, description, feed_token)
           VALUES ($1, $2, $3, $4, $5) RETURNING *"#,
    )
    .bind(&uuid)
    .bind(claims.user_id)
    .bind(&name)
    .bind(req.description.as_deref())
    .bind(&feed_token)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(PlaylistResponse {
        playlist: PlaylistWithCount {
            id: playlist.id,
            uuid: playlist.uuid,
            user_id: playlist.user_id,
            name: playlist.name,
            description: playlist.description,
            cover_image_url: playlist.cover_image_url,
            feed_token: playlist.feed_token,
            is_auto: playlist.is_auto,
            song_count: 0,
            created_at: playlist.created_at,
            updated_at: playlist.updated_at,
        },
    }))
}

// ── Get playlist (public) ──

#[derive(Debug, Serialize)]
pub struct PlaylistDetailResponse {
    pub playlist: PlaylistWithCount,
    pub owner_account_id: String,
    pub owner_display_name: Option<String>,
    pub owner_avatar_url: Option<String>,
}

/// GET /api/playlists/:uuid — get playlist info (public, but feed_token is only shown to owner)
pub async fn get_playlist(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
) -> Result<Json<PlaylistDetailResponse>, (StatusCode, String)> {
    let row = sqlx::query_as::<_, PlaylistWithCount>(
        r#"SELECT p.*, CASE
            WHEN p.is_auto THEN (SELECT COUNT(*) FROM songs s WHERE s.uploader_id = p.user_id AND NOT s.is_deleted AND NOT s.is_hidden AND s.is_validated)
            ELSE COALESCE((SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id), 0)
        END AS song_count
        FROM playlists p WHERE p.uuid = $1"#,
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut playlist = row.ok_or((StatusCode::NOT_FOUND, "Playlist not found".to_string()))?;

    let owner = sqlx::query_as::<_, crate::db::models::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(playlist.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Hide feed_token from non-owners
    let is_owner = crate::auth::jwt::try_auth(&extensions)
        .map_or(false, |c| c.user_id == playlist.user_id);
    if !is_owner {
        playlist.feed_token = String::new();
    }

    Ok(Json(PlaylistDetailResponse {
        playlist,
        owner_account_id: owner.slug,
        owner_display_name: owner.display_name,
        owner_avatar_url: owner.avatar_url,
    }))
}

// ── Update playlist ──

#[derive(Debug, Deserialize)]
pub struct UpdatePlaylistRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub cover_image_url: Option<String>,
}

/// PATCH /api/playlists/:uuid — update playlist (owner only)
pub async fn update_playlist(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
    Json(req): Json<UpdatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        "SELECT * FROM playlists WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Playlist not found".to_string()))?;

    if playlist.user_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not your playlist".to_string()));
    }

    let name = req.name.map(|n| {
        let n = n.trim().to_string();
        if n.is_empty() || n.len() > 200 { Err((StatusCode::BAD_REQUEST, "Name must be 1-200 characters".to_string())) } else { Ok(n) }
    }).transpose()?;

    let updated = sqlx::query_as::<_, crate::db::models::Playlist>(
        r#"UPDATE playlists SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            cover_image_url = COALESCE($4, cover_image_url),
            updated_at = NOW()
        WHERE uuid = $1 RETURNING *"#,
    )
    .bind(&uuid)
    .bind(name)
    .bind(req.description)
    .bind(req.cover_image_url)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let song_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = $1",
    )
    .bind(updated.id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(PlaylistResponse {
        playlist: PlaylistWithCount {
            id: updated.id,
            uuid: updated.uuid,
            user_id: updated.user_id,
            name: updated.name,
            description: updated.description,
            cover_image_url: updated.cover_image_url,
            feed_token: updated.feed_token,
            is_auto: updated.is_auto,
            song_count,
            created_at: updated.created_at,
            updated_at: updated.updated_at,
        },
    }))
}

// ── Delete playlist ──

/// DELETE /api/playlists/:uuid — delete playlist (owner only, cannot delete auto)
pub async fn delete_playlist(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        "SELECT * FROM playlists WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Playlist not found".to_string()))?;

    if playlist.user_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not your playlist".to_string()));
    }

    if playlist.is_auto {
        return Err((StatusCode::BAD_REQUEST, "Cannot delete the auto playlist".to_string()));
    }

    sqlx::query("DELETE FROM playlists WHERE id = $1")
        .bind(playlist.id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── List songs in playlist ──

/// GET /api/playlists/:uuid/songs — list songs (public)
pub async fn list_playlist_songs(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
) -> Result<Json<Vec<SongWithUploader>>, (StatusCode, String)> {
    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        "SELECT * FROM playlists WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Playlist not found".to_string()))?;

    let songs = if playlist.is_auto {
        // Auto playlist: return all user's validated songs
        sqlx::query_as::<_, SongWithUploader>(
            r#"SELECT s.*,
                u.slug AS uploader_account_id,
                u.account_id AS uploader_near_account_id,
                u.display_name AS uploader_display_name,
                u.reputation_score AS uploader_reputation,
                u.twitter_handle AS uploader_twitter_handle,
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
            WHERE s.uploader_id = $1 AND NOT s.is_deleted AND NOT s.is_hidden AND s.is_validated
            ORDER BY s.created_at DESC"#,
        )
        .bind(playlist.user_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        sqlx::query_as::<_, SongWithUploader>(
            r#"SELECT s.*,
                u.slug AS uploader_account_id,
                u.account_id AS uploader_near_account_id,
                u.display_name AS uploader_display_name,
                u.reputation_score AS uploader_reputation,
                u.twitter_handle AS uploader_twitter_handle,
                c.name AS category_name,
                c.slug AS category_slug,
                l.code AS language_code,
                l.name AS language_name,
                (SELECT COUNT(*) FROM comments cm WHERE cm.song_id = s.id AND NOT cm.is_hidden) AS comment_count,
                COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'slug', g.slug, 'display_order', g.display_order, 'created_at', g.created_at))::text FROM song_genres sg JOIN genres g ON g.id = sg.genre_id WHERE sg.song_id = s.id), '[]') AS genres_json
            FROM playlist_songs ps
            JOIN songs s ON ps.song_id = s.id
            JOIN users u ON s.uploader_id = u.id
            LEFT JOIN categories c ON s.category_id = c.id
            LEFT JOIN languages l ON s.language_id = l.id
            WHERE ps.playlist_id = $1 AND NOT s.is_deleted AND NOT s.is_hidden
            ORDER BY ps.position, ps.added_at"#,
        )
        .bind(playlist.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    Ok(Json(songs))
}

// ── Add song to playlist ──

#[derive(Debug, Deserialize)]
pub struct AddSongRequest {
    pub song_uuid: String,
}

/// POST /api/playlists/:uuid/songs — add song (premium, owner, non-auto only)
pub async fn add_song_to_playlist(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
    Json(req): Json<AddSongRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let user = sqlx::query_as::<_, crate::db::models::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    require_premium(user.premium_until)?;

    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        "SELECT * FROM playlists WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Playlist not found".to_string()))?;

    if playlist.user_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not your playlist".to_string()));
    }

    if playlist.is_auto {
        return Err((StatusCode::BAD_REQUEST, "Cannot manually add songs to the auto playlist".to_string()));
    }

    let song = sqlx::query_as::<_, crate::db::models::Song>(
        "SELECT * FROM songs WHERE uuid = $1 AND NOT is_deleted",
    )
    .bind(&req.song_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    let max_pos = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT MAX(position) FROM playlist_songs WHERE playlist_id = $1",
    )
    .bind(playlist.id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, $3) ON CONFLICT (playlist_id, song_id) DO NOTHING",
    )
    .bind(playlist.id)
    .bind(song.id)
    .bind(max_pos.unwrap_or(-1) + 1)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE playlists SET updated_at = NOW() WHERE id = $1")
        .bind(playlist.id)
        .execute(&state.db)
        .await
        .ok();

    Ok(StatusCode::CREATED)
}

// ── Remove song from playlist ──

/// DELETE /api/playlists/:uuid/songs/:song_uuid — remove song (owner, non-auto only)
pub async fn remove_song_from_playlist(
    State(state): State<AppState>,
    extensions: Extensions,
    Path((uuid, song_uuid)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        "SELECT * FROM playlists WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Playlist not found".to_string()))?;

    if playlist.user_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not your playlist".to_string()));
    }

    if playlist.is_auto {
        return Err((StatusCode::BAD_REQUEST, "Cannot manually remove songs from the auto playlist".to_string()));
    }

    let song = sqlx::query_as::<_, crate::db::models::Song>(
        "SELECT * FROM songs WHERE uuid = $1",
    )
    .bind(&song_uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    sqlx::query("DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2")
        .bind(playlist.id)
        .bind(song.id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE playlists SET updated_at = NOW() WHERE id = $1")
        .bind(playlist.id)
        .execute(&state.db)
        .await
        .ok();

    Ok(StatusCode::NO_CONTENT)
}

// ── Reorder songs in playlist ──

#[derive(Deserialize)]
pub struct ReorderRequest {
    /// Ordered list of song UUIDs in desired order
    pub song_uuids: Vec<String>,
}

/// PUT /api/playlists/:uuid/reorder — set song order (owner, non-auto only)
pub async fn reorder_playlist_songs(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
    Json(req): Json<ReorderRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        "SELECT * FROM playlists WHERE uuid = $1",
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Playlist not found".to_string()))?;

    if playlist.user_id != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not your playlist".to_string()));
    }

    if playlist.is_auto {
        return Err((StatusCode::BAD_REQUEST, "Cannot reorder auto playlist".to_string()));
    }

    // Update positions based on the order of UUIDs
    for (i, song_uuid) in req.song_uuids.iter().enumerate() {
        sqlx::query(
            "UPDATE playlist_songs SET position = $1 WHERE playlist_id = $2 AND song_id = (SELECT id FROM songs WHERE uuid = $3)"
        )
        .bind(i as i32)
        .bind(playlist.id)
        .bind(song_uuid)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    sqlx::query("UPDATE playlists SET updated_at = NOW() WHERE id = $1")
        .bind(playlist.id)
        .execute(&state.db)
        .await
        .ok();

    Ok(StatusCode::OK)
}
