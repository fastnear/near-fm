use sqlx::PgPool;

use super::models::*;

// ── Users ──

pub async fn get_or_create_user(
    pool: &PgPool,
    account_id: &str,
    is_admin: bool,
) -> Result<User, sqlx::Error> {
    // Try to find existing user, update is_admin from config
    if let Some(user) = sqlx::query_as::<_, User>(
        "UPDATE users SET is_admin = $2 WHERE account_id = $1 RETURNING *",
    )
    .bind(account_id)
    .bind(is_admin)
    .fetch_optional(pool)
    .await?
    {
        return Ok(user);
    }

    // Create new user (slug = account_id for NEAR users)
    sqlx::query_as::<_, User>(
        "INSERT INTO users (account_id, slug, is_admin, auth_provider) VALUES ($1, $1, $2, 'near') RETURNING *",
    )
    .bind(account_id)
    .bind(is_admin)
    .fetch_one(pool)
    .await
}

pub async fn get_user_by_account(
    pool: &PgPool,
    account_id: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE account_id = $1")
        .bind(account_id)
        .fetch_optional(pool)
        .await
}

pub async fn get_user_by_slug(
    pool: &PgPool,
    slug: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE slug = $1")
        .bind(slug)
        .fetch_optional(pool)
        .await
}

pub async fn get_user_by_google_id(
    pool: &PgPool,
    google_id: &str,
) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE google_id = $1")
        .bind(google_id)
        .fetch_optional(pool)
        .await
}

pub async fn create_google_user(
    pool: &PgPool,
    google_id: &str,
    email: &str,
    display_name: &str,
    avatar_url: Option<&str>,
    slug: &str,
) -> Result<User, sqlx::Error> {
    sqlx::query_as::<_, User>(
        r#"INSERT INTO users (google_id, email, display_name, avatar_url, slug, auth_provider)
           VALUES ($1, $2, $3, $4, $5, 'google')
           RETURNING *"#,
    )
    .bind(google_id)
    .bind(email)
    .bind(display_name)
    .bind(avatar_url)
    .bind(slug)
    .fetch_one(pool)
    .await
}

pub async fn link_near_wallet(
    pool: &PgPool,
    user_id: i32,
    account_id: &str,
) -> Result<User, sqlx::Error> {
    sqlx::query_as::<_, User>(
        "UPDATE users SET account_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    )
    .bind(account_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

// ── Songs ──

pub async fn create_song(
    pool: &PgPool,
    uuid: &str,
    uploader_id: i32,
    title: &str,
    description: Option<&str>,
    lyrics: Option<&str>,
    ai_model: Option<&str>,
    audio_url: &str,
    audio_hash: &str,
    audio_duration_seconds: Option<i32>,
    audio_mime_type: &str,
    cover_image_url: Option<&str>,
    language_id: Option<i32>,
    category_id: Option<i32>,
    fulfills_request_id: Option<i32>,
) -> Result<Song, sqlx::Error> {
    sqlx::query_as::<_, Song>(
        r#"INSERT INTO songs
            (uuid, uploader_id, title, description, lyrics, ai_model,
             audio_url, audio_hash, audio_duration_seconds, audio_mime_type,
             cover_image_url, language_id, category_id, fulfills_request_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *"#,
    )
    .bind(uuid)
    .bind(uploader_id)
    .bind(title)
    .bind(description)
    .bind(lyrics)
    .bind(ai_model)
    .bind(audio_url)
    .bind(audio_hash)
    .bind(audio_duration_seconds)
    .bind(audio_mime_type)
    .bind(cover_image_url)
    .bind(language_id)
    .bind(category_id)
    .bind(fulfills_request_id)
    .fetch_one(pool)
    .await
}

pub async fn get_song_by_uuid(
    pool: &PgPool,
    uuid: &str,
) -> Result<Option<SongWithUploader>, sqlx::Error> {
    sqlx::query_as::<_, SongWithUploader>(
        r#"SELECT s.*,
            u.slug AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation,
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
           WHERE s.uuid = $1 AND NOT s.is_deleted"#,
    )
    .bind(uuid)
    .fetch_optional(pool)
    .await
}

pub async fn list_songs(
    pool: &PgPool,
    sort: &str,
    language_id: Option<i32>,
    category_id: Option<i32>,
    search_query: Option<&str>,
    period: Option<&str>,
    genre_slug: Option<&str>,
    lang_code: Option<&str>,
    excluded_genre_ids: &[i32],
    excluded_language_ids: &[i32],
    excluded_category_ids: &[i32],
    hide_no_cover: bool,
    limit: i64,
    offset: i64,
    follower_user_id: Option<i32>,
    blocked_user_ids: &[i32],
) -> Result<Vec<SongWithUploader>, sqlx::Error> {
    let final_sql = r#"SELECT s.*,
            u.slug AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation,
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
           WHERE NOT s.is_deleted AND NOT s.is_hidden AND s.is_validated
             AND ($3::INTEGER IS NULL OR s.language_id = $3)
             AND ($4::INTEGER IS NULL OR s.category_id = $4)
             AND ($5::TEXT IS NULL OR s.search_vector @@ plainto_tsquery('simple', $5))
             AND ($6::TEXT IS NULL OR $6 = 'all' OR
                  CASE $6
                    WHEN 'day' THEN s.created_at >= NOW() - INTERVAL '1 day'
                    WHEN 'week' THEN s.created_at >= NOW() - INTERVAL '7 days'
                    WHEN 'month' THEN s.created_at >= NOW() - INTERVAL '30 days'
                    ELSE TRUE
                  END)
             AND ($8::TEXT IS NULL OR EXISTS (
                SELECT 1 FROM song_genres sg2 JOIN genres g2 ON g2.id = sg2.genre_id
                WHERE sg2.song_id = s.id AND g2.slug = $8
             ))
             AND ($9::TEXT IS NULL OR l.code = $9)
             AND (CARDINALITY($10::int[]) = 0 OR NOT EXISTS (
                SELECT 1 FROM song_genres sg3
                WHERE sg3.song_id = s.id AND sg3.genre_id = ANY($10)
             ))
             AND (CARDINALITY($11::int[]) = 0 OR s.language_id IS NULL OR s.language_id != ALL($11))
             AND (CARDINALITY($12::int[]) = 0 OR s.category_id IS NULL OR s.category_id != ALL($12))
             AND (NOT $13::BOOL OR s.cover_image_url IS NOT NULL)
             AND ($14::INTEGER IS NULL OR s.uploader_id IN (SELECT followed_id FROM user_follows WHERE follower_id = $14))
             AND (CARDINALITY($15::int[]) = 0 OR s.uploader_id != ALL($15))
           ORDER BY
             CASE WHEN $7 = 'latest' THEN EXTRACT(EPOCH FROM s.created_at) END DESC,
             CASE WHEN $7 = 'top' THEN (s.upvotes - s.downvotes)::FLOAT END DESC,
             CASE WHEN $7 = 'trending' OR $7 IS NULL THEN s.score END DESC,
             s.created_at DESC
           LIMIT $1 OFFSET $2"#;

    let period_str = match sort {
        "top" => period.unwrap_or("all"),
        _ => "all",
    };

    sqlx::query_as::<_, SongWithUploader>(final_sql)
        .bind(limit)
        .bind(offset)
        .bind(language_id)
        .bind(category_id)
        .bind(search_query)
        .bind(period_str)
        .bind(sort)
        .bind(genre_slug)
        .bind(lang_code)
        .bind(excluded_genre_ids)
        .bind(excluded_language_ids)
        .bind(excluded_category_ids)
        .bind(hide_no_cover)
        .bind(follower_user_id)
        .bind(blocked_user_ids)
        .fetch_all(pool)
        .await
}

pub async fn check_audio_hash_exists(
    pool: &PgPool,
    audio_hash: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM songs WHERE audio_hash = $1 AND NOT is_deleted AND NOT is_hidden)",
    )
    .bind(audio_hash)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

pub async fn increment_play_count(
    pool: &PgPool,
    song_uuid: &str,
) -> Result<i32, sqlx::Error> {
    let row = sqlx::query_scalar::<_, i32>(
        "UPDATE songs SET play_count = play_count + 1 WHERE uuid = $1 RETURNING play_count",
    )
    .bind(song_uuid)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

// ── Votes ──

pub async fn upsert_vote(
    pool: &PgPool,
    song_id: i32,
    user_id: i32,
    value: i16,
    weight: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO votes (song_id, user_id, value, weight)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (song_id, user_id)
           DO UPDATE SET value = $3, weight = $4"#,
    )
    .bind(song_id)
    .bind(user_id)
    .bind(value)
    .bind(weight)
    .execute(pool)
    .await?;

    // Recalculate song vote counts
    sqlx::query(
        r#"UPDATE songs SET
            upvotes = (SELECT COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) FROM votes WHERE song_id = $1),
            downvotes = (SELECT COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) FROM votes WHERE song_id = $1),
            updated_at = NOW()
           WHERE id = $1"#,
    )
    .bind(song_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn delete_vote(
    pool: &PgPool,
    song_id: i32,
    user_id: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM votes WHERE song_id = $1 AND user_id = $2")
        .bind(song_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    // Recalculate song vote counts
    sqlx::query(
        r#"UPDATE songs SET
            upvotes = (SELECT COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0) FROM votes WHERE song_id = $1),
            downvotes = (SELECT COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0) FROM votes WHERE song_id = $1),
            updated_at = NOW()
           WHERE id = $1"#,
    )
    .bind(song_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn get_user_vote(
    pool: &PgPool,
    song_id: i32,
    user_id: i32,
) -> Result<Option<i16>, sqlx::Error> {
    sqlx::query_scalar::<_, i16>(
        "SELECT value FROM votes WHERE song_id = $1 AND user_id = $2",
    )
    .bind(song_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

// ── Bookmarks ──

pub async fn add_bookmark(
    pool: &PgPool,
    user_id: i32,
    song_id: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO bookmarks (user_id, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(song_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_bookmark(
    pool: &PgPool,
    user_id: i32,
    song_id: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM bookmarks WHERE user_id = $1 AND song_id = $2")
        .bind(user_id)
        .bind(song_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Notifications ──

pub async fn create_notification(
    pool: &PgPool,
    user_id: i32,
    notification_type: &str,
    data: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(notification_type)
    .bind(data)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_unread_count(pool: &PgPool, user_id: i32) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND NOT is_read",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
}

// ── Categories & Languages ──

pub async fn list_categories(pool: &PgPool) -> Result<Vec<Category>, sqlx::Error> {
    sqlx::query_as::<_, Category>(
        "SELECT * FROM categories ORDER BY display_order",
    )
    .fetch_all(pool)
    .await
}

pub async fn list_languages(pool: &PgPool) -> Result<Vec<Language>, sqlx::Error> {
    sqlx::query_as::<_, Language>("SELECT * FROM languages ORDER BY name")
        .fetch_all(pool)
        .await
}

// ── Genres ──

pub async fn list_genres(pool: &PgPool) -> Result<Vec<Genre>, sqlx::Error> {
    sqlx::query_as::<_, Genre>("SELECT * FROM genres ORDER BY display_order")
        .fetch_all(pool)
        .await
}

pub async fn get_user_vote_preferences(
    pool: &PgPool,
    user_id: i32,
) -> Result<(Vec<i32>, Vec<i32>), sqlx::Error> {
    // Get genre_ids and language_ids from songs the user has upvoted (last 50)
    let rows: Vec<(Option<i32>, Option<serde_json::Value>)> = sqlx::query_as(
        r#"SELECT s.language_id,
                  (SELECT json_agg(sg.genre_id) FROM song_genres sg WHERE sg.song_id = s.id)
           FROM votes v
           JOIN songs s ON v.song_id = s.id
           WHERE v.user_id = $1 AND v.value = 1
           ORDER BY v.created_at DESC
           LIMIT 50"#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut genre_ids = Vec::new();
    let mut language_ids = Vec::new();

    for (lang_id, genres_json) in &rows {
        if let Some(lid) = lang_id {
            if !language_ids.contains(lid) {
                language_ids.push(*lid);
            }
        }
        if let Some(serde_json::Value::Array(arr)) = genres_json {
            for v in arr {
                if let Some(gid) = v.as_i64() {
                    let gid = gid as i32;
                    if !genre_ids.contains(&gid) {
                        genre_ids.push(gid);
                    }
                }
            }
        }
    }

    Ok((genre_ids, language_ids))
}

pub async fn get_top_trending_songs(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<SongWithUploader>, sqlx::Error> {
    sqlx::query_as::<_, SongWithUploader>(
        r#"SELECT s.*,
            u.slug AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation,
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
           WHERE NOT s.is_deleted AND NOT s.is_hidden AND s.is_validated
           ORDER BY s.score DESC
           LIMIT $1"#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn set_song_genres(
    pool: &PgPool,
    song_id: i32,
    genre_ids: &[i32],
) -> Result<(), sqlx::Error> {
    // Delete existing
    sqlx::query("DELETE FROM song_genres WHERE song_id = $1")
        .bind(song_id)
        .execute(pool)
        .await?;

    // Insert new (max 3)
    for &genre_id in genre_ids.iter().take(3) {
        sqlx::query("INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(song_id)
            .bind(genre_id)
            .execute(pool)
            .await?;
    }

    Ok(())
}
