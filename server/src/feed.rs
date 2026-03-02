use sqlx::PgPool;
use std::time::Duration;

/// Recalculate trending scores for all active songs.
///
/// Formula:
///   base = weighted_upvotes - weighted_downvotes
///        + log10(max(plays, 1)) * 2
///        + log10(max(tips_near, 0.01) + 1) * 9
///
///   Vote weights: voters with reputation <= 1.0 get weight * 0.5 (anti-spam)
///
///   If uploader.total_uploads < 3 AND uploader.reputation_score < 1.5:
///       base *= 0.5   (newbie penalty)
///
///   effective_age = max(hours_age - 24, 0)   (no decay in first 24h)
///   score = base / (effective_age + 2)^1.8
pub async fn recalculate_feed_scores(pool: &PgPool) -> Result<(), sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE songs
        SET score = sub.new_score,
            updated_at = NOW()
        FROM (
            SELECT
                s.id,
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
                * CASE
                    WHEN s.lyrics IS NULL OR s.lyrics = '' THEN 0.7
                    WHEN LENGTH(s.lyrics) < 200 THEN 0.85
                    ELSE 1.0
                  END
                * CASE WHEN s.cover_image_url IS NULL THEN 0.7 ELSE 1.0 END
                / POWER(
                    GREATEST(EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600.0 - 24, 0) + 2,
                    1.8
                  )
                AS new_score
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
              AND s.is_hidden = FALSE
        ) sub
        WHERE songs.id = sub.id
        "#,
    )
    .execute(pool)
    .await?;

    tracing::info!(
        "Feed scores recalculated for {} songs",
        result.rows_affected()
    );

    Ok(())
}

/// Spawns a background loop that recalculates feed scores every 5 minutes.
pub async fn start_feed_scoring_loop(pool: PgPool) {
    let mut interval = tokio::time::interval(Duration::from_secs(5 * 60));

    loop {
        interval.tick().await;

        tracing::info!("Running feed score recalculation...");

        if let Err(e) = recalculate_feed_scores(&pool).await {
            tracing::error!("Feed score recalculation failed: {}", e);
        }
    }
}
