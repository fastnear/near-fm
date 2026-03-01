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

    // Create new user
    sqlx::query_as::<_, User>(
        "INSERT INTO users (account_id, is_admin) VALUES ($1, $2) RETURNING *",
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
            u.account_id AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation
           FROM songs s
           JOIN users u ON s.uploader_id = u.id
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
    limit: i64,
    offset: i64,
) -> Result<Vec<SongWithUploader>, sqlx::Error> {
    let mut sql = String::from(
        r#"SELECT s.*,
            u.account_id AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation
           FROM songs s
           JOIN users u ON s.uploader_id = u.id
           WHERE NOT s.is_deleted AND NOT s.is_hidden"#,
    );

    let mut param_idx = 1u32;
    let mut binds: Vec<Box<dyn std::any::Any>> = Vec::new();

    if language_id.is_some() {
        param_idx += 1;
        sql.push_str(&format!(" AND s.language_id = ${}", param_idx));
    }
    if category_id.is_some() {
        param_idx += 1;
        sql.push_str(&format!(" AND s.category_id = ${}", param_idx));
    }
    if search_query.is_some() {
        param_idx += 1;
        sql.push_str(&format!(
            " AND s.search_vector @@ plainto_tsquery('simple', ${})",
            param_idx
        ));
    }

    // Period filter for "top" sort
    if sort == "top" {
        if let Some(p) = period {
            let interval = match p {
                "day" => "1 day",
                "week" => "7 days",
                "month" => "30 days",
                _ => "100 years", // "all"
            };
            sql.push_str(&format!(
                " AND s.created_at >= NOW() - INTERVAL '{}'",
                interval
            ));
        }
    }

    // Sort
    match sort {
        "latest" => sql.push_str(" ORDER BY s.created_at DESC"),
        "top" => sql.push_str(" ORDER BY (s.upvotes - s.downvotes) DESC, s.created_at DESC"),
        _ => sql.push_str(" ORDER BY s.score DESC, s.created_at DESC"), // trending
    }

    sql.push_str(" LIMIT $1 OFFSET $2");

    // For now, use a simpler approach with fixed parameter positions
    // We'll build the query dynamically
    drop(binds);

    // Simplified approach: build with all parameters always present
    let final_sql = r#"SELECT s.*,
            u.account_id AS uploader_account_id,
            u.display_name AS uploader_display_name,
            u.reputation_score AS uploader_reputation
           FROM songs s
           JOIN users u ON s.uploader_id = u.id
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
