use axum::{extract::State, http::{Extensions, StatusCode}, Json};
use serde::{Deserialize, Serialize};

use crate::{auth::jwt::require_auth, db::queries, AppState};

#[derive(Debug, Deserialize)]
pub struct RecordTipRequest {
    pub song_uuid: String,
    pub tx_hash: String,
    pub amount_yocto: String,
    pub from_balance: bool,
}

#[derive(Debug, Serialize)]
pub struct TipResponse {
    pub id: i32,
}

pub async fn record_tip(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<RecordTipRequest>,
) -> Result<Json<TipResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Get the song
    let song = queries::get_song_by_uuid(&state.db, &req.song_uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    // Record the tip
    let tip_id = sqlx::query_scalar::<_, i32>(
        r#"INSERT INTO tips (song_id, tipper_id, recipient_id, amount_yocto, tx_hash, from_balance)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id"#,
    )
    .bind(song.id)
    .bind(claims.user_id)
    .bind(song.uploader_id)
    .bind(&req.amount_yocto)
    .bind(&req.tx_hash)
    .bind(req.from_balance)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update song tips total
    sqlx::query(
        r#"UPDATE songs SET
            total_tips_yocto = (
                CAST(total_tips_yocto AS NUMERIC) + CAST($1 AS NUMERIC)
            )::TEXT
           WHERE id = $2"#,
    )
    .bind(&req.amount_yocto)
    .bind(song.id)
    .execute(&state.db)
    .await
    .ok();

    // Update recipient's total tips
    sqlx::query(
        r#"UPDATE users SET
            total_tips_received_yocto = (
                CAST(total_tips_received_yocto AS NUMERIC) + CAST($1 AS NUMERIC)
            )::TEXT
           WHERE id = $2"#,
    )
    .bind(&req.amount_yocto)
    .bind(song.uploader_id)
    .execute(&state.db)
    .await
    .ok();

    // Create notification for the recipient
    queries::create_notification(
        &state.db,
        song.uploader_id,
        "tip_received",
        &serde_json::json!({
            "song_uuid": req.song_uuid,
            "from_account": claims.sub,
            "amount_yocto": req.amount_yocto,
        }),
    )
    .await
    .ok();

    Ok(Json(TipResponse { id: tip_id }))
}
