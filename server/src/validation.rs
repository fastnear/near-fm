use sqlx::PgPool;

const MAX_AUDIO_SIZE: u64 = 50 * 1024 * 1024; // 50 MB

const VALIDATION_INITIAL_DELAY_SECS: u64 = 30;
const VALIDATION_RETRIES: u32 = 15;
const RETRY_DELAY_SECS: u64 = 30;
const COVER_CHECK_RETRIES: u32 = 10;
const COVER_CHECK_DELAY_SECS: u64 = 20;

/// Validate an audio file by checking its HTTP response metadata.
///
/// Waits for FastFS to index the data before checking, then retries on failure.
/// Total wait time: 30s initial + up to 7 retries * 30s = ~4 minutes.
///
/// Checks performed:
/// - HTTP status is 200
/// - Content-Type header starts with "audio/" or "video/"
/// - Content-Length is at most 50 MB
///
/// On success: marks the song as validated, notifies uploader.
/// On failure: hides the song and creates a notification for the uploader.
async fn validate_audio(pool: &PgPool, song_id: i32, audio_url: String) {
    // Wait for FastFS to index the uploaded data
    tokio::time::sleep(std::time::Duration::from_secs(VALIDATION_INITIAL_DELAY_SECS)).await;

    for attempt in 0..VALIDATION_RETRIES {
        match do_validate(pool, song_id, &audio_url).await {
            Ok(()) => {
                tracing::info!(song_id, "Audio validation passed");
                notify_validated(pool, song_id).await;
                return;
            }
            Err(reason) => {
                if attempt + 1 < VALIDATION_RETRIES {
                    tracing::info!(song_id, attempt, %reason, "Audio validation attempt failed, retrying");
                    tokio::time::sleep(std::time::Duration::from_secs(RETRY_DELAY_SECS)).await;
                } else {
                    tracing::warn!(song_id, %reason, "Audio validation failed, hiding song");
                    mark_invalid(pool, song_id, &reason).await;
                }
            }
        }
    }
}

async fn do_validate(pool: &PgPool, song_id: i32, audio_url: &str) -> Result<(), String> {
    let client = reqwest::Client::new();

    let response = client
        .get(audio_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch audio URL: {}", e))?;

    // Check HTTP status
    if response.status().as_u16() != 200 {
        return Err(format!(
            "Unexpected HTTP status: {}",
            response.status()
        ));
    }

    // Check Content-Type
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.starts_with("audio/") && !content_type.starts_with("video/") {
        return Err(format!(
            "Invalid content type: expected audio/* or video/*, got '{}'",
            content_type
        ));
    }

    // Check Content-Length
    if let Some(content_length) = response.content_length() {
        if content_length > MAX_AUDIO_SIZE {
            return Err(format!(
                "Audio file too large: {} bytes (max {} bytes)",
                content_length, MAX_AUDIO_SIZE
            ));
        }
    }

    // All checks passed -- mark as validated
    if let Err(e) = sqlx::query("UPDATE songs SET is_validated = true WHERE id = $1")
        .bind(song_id)
        .execute(pool)
        .await
    {
        tracing::error!(song_id, "Failed to mark song as validated: {}", e);
    }

    Ok(())
}

/// Notify the uploader that their song has been validated and is now live.
async fn notify_validated(pool: &PgPool, song_id: i32) {
    let row: Option<(i32, String, String)> = sqlx::query_as(
        "SELECT s.uploader_id, s.uuid, s.title FROM songs s WHERE s.id = $1",
    )
    .bind(song_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some((uploader_id, song_uuid, song_title)) = row else { return };

    let data = serde_json::json!({
        "song_id": song_id,
        "song_uuid": song_uuid,
        "song_title": song_title,
    });

    sqlx::query(
        "INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)",
    )
    .bind(uploader_id)
    .bind("song_validated")
    .bind(&data)
    .execute(pool)
    .await
    .ok();
}

/// Hide the song and notify the uploader about the failed validation.
async fn mark_invalid(pool: &PgPool, song_id: i32, reason: &str) {
    // Hide the song
    if let Err(e) = sqlx::query("UPDATE songs SET is_hidden = true WHERE id = $1")
        .bind(song_id)
        .execute(pool)
        .await
    {
        tracing::error!(song_id, "Failed to hide invalid song: {}", e);
        return;
    }

    // Look up the uploader to create a notification
    let uploader_id: Option<i32> =
        match sqlx::query_scalar::<_, i32>("SELECT uploader_id FROM songs WHERE id = $1")
            .bind(song_id)
            .fetch_optional(pool)
            .await
        {
            Ok(id) => id,
            Err(e) => {
                tracing::error!(song_id, "Failed to fetch uploader for notification: {}", e);
                return;
            }
        };

    let Some(uploader_id) = uploader_id else {
        tracing::warn!(song_id, "Song not found when creating validation notification");
        return;
    };

    let data = serde_json::json!({
        "song_id": song_id,
        "reason": reason,
    });

    if let Err(e) = sqlx::query(
        "INSERT INTO notifications (user_id, type, data) VALUES ($1, $2, $3)",
    )
    .bind(uploader_id)
    .bind("audio_validation_failed")
    .bind(&data)
    .execute(pool)
    .await
    {
        tracing::error!(
            song_id,
            uploader_id,
            "Failed to create validation failure notification: {}",
            e
        );
    }
}

/// Spawn background tasks to validate a song's audio file and cover image.
///
/// This is intended to be called from the `create_song` route handler
/// immediately after a song is created. It does not block the response.
pub fn spawn_validation(pool: PgPool, song_id: i32, audio_url: String, cover_url: Option<String>) {
    let pool2 = pool.clone();
    tokio::spawn(async move {
        validate_audio(&pool, song_id, audio_url).await;
    });
    if let Some(cover) = cover_url {
        tokio::spawn(async move {
            validate_cover(&pool2, song_id, cover).await;
        });
    }
}

/// Check that the cover image is accessible on FastFS.
/// Retries until available, but does not hide the song on failure.
async fn validate_cover(pool: &PgPool, song_id: i32, cover_url: String) {
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;

    let client = reqwest::Client::new();
    for attempt in 0..COVER_CHECK_RETRIES {
        match client.head(&cover_url).send().await {
            Ok(resp) if resp.status().as_u16() == 200 => {
                tracing::info!(song_id, "Cover image validated");
                return;
            }
            Ok(resp) => {
                tracing::info!(song_id, attempt, status = %resp.status(), "Cover not ready yet, retrying");
            }
            Err(e) => {
                tracing::info!(song_id, attempt, %e, "Cover check failed, retrying");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(COVER_CHECK_DELAY_SECS)).await;
    }
    // Cover never became available — clear it from the song
    tracing::warn!(song_id, "Cover image not available after retries, clearing");
    sqlx::query("UPDATE songs SET cover_image_url = NULL WHERE id = $1")
        .bind(song_id)
        .execute(pool)
        .await
        .ok();
}
