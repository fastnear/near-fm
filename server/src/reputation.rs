use sqlx::PgPool;
use std::time::Duration;

/// Recalculate reputation scores for all users.
///
/// Formula:
///   base = 1.0
///       + LEAST(total_uploads, 10) * 0.1            (max contribution 1.0)
///       + LEAST(unique_tipped_songs, 10) * 0.2       (max contribution 2.0)
///       + log10(total_tips_near + 1) * 0.5
///
///   Clamped to [0.1, 5.0].
///   If user is_banned, reputation = 0.1.
pub async fn recalculate_reputation(pool: &PgPool) -> Result<(), sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE users
        SET reputation_score = sub.new_reputation,
            updated_at = NOW()
        FROM (
            SELECT
                u.id,
                CASE
                    WHEN u.is_banned THEN 0.1
                    ELSE GREATEST(0.1, LEAST(5.0,
                        1.0
                        + LEAST(u.total_uploads, 10)::NUMERIC * 0.1
                        + LEAST(COALESCE(tipped.unique_tipped_songs, 0), 10)::NUMERIC * 0.2
                        + LOG(
                            CAST(u.total_tips_received_yocto AS NUMERIC) / 1e24 + 1
                          ) * 0.5
                    ))
                END AS new_reputation
            FROM users u
            LEFT JOIN (
                SELECT
                    s.uploader_id,
                    COUNT(DISTINCT s.id) AS unique_tipped_songs
                FROM songs s
                WHERE CAST(s.total_tips_yocto AS NUMERIC) > 0
                GROUP BY s.uploader_id
            ) tipped ON tipped.uploader_id = u.id
        ) sub
        WHERE users.id = sub.id
        "#,
    )
    .execute(pool)
    .await?;

    tracing::info!(
        "Reputation recalculated for {} users",
        result.rows_affected()
    );

    Ok(())
}

/// Spawns a background loop that recalculates user reputation every 10 minutes.
pub async fn start_reputation_loop(pool: PgPool) {
    let mut interval = tokio::time::interval(Duration::from_secs(10 * 60));

    loop {
        interval.tick().await;

        tracing::info!("Running reputation recalculation...");

        if let Err(e) = recalculate_reputation(&pool).await {
            tracing::error!("Reputation recalculation failed: {}", e);
        }
    }
}
