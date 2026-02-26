use sqlx::PgPool;

const MAX_AUDIO_SIZE: u64 = 50 * 1024 * 1024; // 50 MB

/// Validate an audio file by checking its HTTP response metadata.
///
/// Checks performed:
/// - HTTP status is 200
/// - Content-Type header starts with "audio/"
/// - Content-Length is at most 50 MB
///
/// On success: marks the song as validated.
/// On failure: hides the song and creates a notification for the uploader.
async fn validate_audio(pool: &PgPool, song_id: i32, audio_url: String) {
    match do_validate(pool, song_id, &audio_url).await {
        Ok(()) => {
            tracing::info!(song_id, "Audio validation passed");
        }
        Err(reason) => {
            tracing::warn!(song_id, %reason, "Audio validation failed, hiding song");
            mark_invalid(pool, song_id, &reason).await;
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

    if !content_type.starts_with("audio/") {
        return Err(format!(
            "Invalid content type: expected audio/*, got '{}'",
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

/// Spawn a background task to validate a song's audio file.
///
/// This is intended to be called from the `create_song` route handler
/// immediately after a song is created. It does not block the response.
pub fn spawn_validation(pool: PgPool, song_id: i32, audio_url: String) {
    tokio::spawn(async move {
        validate_audio(&pool, song_id, audio_url).await;
    });
}
