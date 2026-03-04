use axum::{extract::State, http::{Extensions, StatusCode}, Json};
use serde::{Deserialize, Serialize};

use crate::{auth::jwt::require_auth, db::queries, near::tx_verify, AppState};

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

    // Require a linked NEAR wallet for tips
    // Fallback: for NEAR-only users with old JWTs, sub == account_id
    let near_account = claims.account_id.as_deref()
        .or_else(|| {
            // Old JWTs don't have account_id field; for NEAR users slug == account_id
            if claims.sub.contains('.') { Some(claims.sub.as_str()) } else { None }
        })
        .ok_or_else(|| {
            (StatusCode::FORBIDDEN, "Connect a NEAR wallet to send tips".to_string())
        })?
        .to_string();

    // Verify transaction on-chain
    let verified = tx_verify::verify_near_tx(
        &state.config.near_rpc_url,
        &req.tx_hash,
        &near_account,
    )
    .await
    .map_err(|e| {
        tracing::warn!("TX verification failed for {}: {}", req.tx_hash, e);
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

    // Get the song
    let song = queries::get_song_by_uuid(&state.db, &req.song_uuid)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;

    // Use on-chain amount instead of client-provided amount
    let amount_yocto = if req.from_balance {
        // For tip_from_balance, amount is in args
        verified.args_json["amount"]
            .as_str()
            .unwrap_or(&req.amount_yocto)
            .to_string()
    } else {
        // For direct tip, amount is the deposit
        if verified.deposit != "0" { verified.deposit.clone() } else { req.amount_yocto.clone() }
    };

    // Record the tip
    let tip_id = sqlx::query_scalar::<_, i32>(
        r#"INSERT INTO tips (song_id, tipper_id, recipient_id, amount_yocto, tx_hash, from_balance)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id"#,
    )
    .bind(song.id)
    .bind(claims.user_id)
    .bind(song.uploader_id)
    .bind(&amount_yocto)
    .bind(&req.tx_hash)
    .bind(req.from_balance)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        if e.to_string().contains("idx_tips_tx_hash_unique") {
            (StatusCode::CONFLICT, "This transaction has already been recorded".to_string())
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        }
    })?;

    // Update song tips total
    sqlx::query(
        r#"UPDATE songs SET
            total_tips_yocto = (
                CAST(total_tips_yocto AS NUMERIC) + CAST($1 AS NUMERIC)
            )::TEXT
           WHERE id = $2"#,
    )
    .bind(&amount_yocto)
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
    .bind(&amount_yocto)
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
            "song_title": song.title,
            "from_account": claims.sub,
            "amount_yocto": amount_yocto,
        }),
    )
    .await
    .ok();

    Ok(Json(TipResponse { id: tip_id }))
}
