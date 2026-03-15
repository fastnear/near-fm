use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db::queries, AppState};

const OUTLAYER_API: &str = "https://api.outlayer.fastnear.com";

// Accepted stablecoin contracts (both 6 decimals) — mirrors credits.rs
const USDC_TOKEN: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT_TOKEN: &str = "usdt.tether-token.near";

// 1 USD = 1_000_000 raw units (6 decimals)
const RAW_UNITS_PER_USD: u128 = 1_000_000;
const MIN_USD: u128 = 10;

/// $10 = 30 days, $20 = 60, $30 = 90, etc. Capped at 365.
fn usd_to_days(usd: u128) -> i32 {
    (usd * 3).min(365) as i32
}

// ── Request / Response ──

#[derive(Debug, Deserialize)]
pub struct SubscribeRequest {
    pub check_key: String,
    pub account_id: String, // recipient
}

#[derive(Debug, Serialize)]
pub struct SubscribeResponse {
    pub premium_until: String, // RFC 3339
    pub days_added: i32,
    pub is_gift: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReceivedGiftEntry {
    pub from_account_id: String,
    pub from_display_name: Option<String>,
    pub from_avatar_url: Option<String>,
    pub days_added: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SentGiftEntry {
    pub to_account_id: String,
    pub to_display_name: Option<String>,
    pub to_avatar_url: Option<String>,
    pub days_added: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct GiftsResponse {
    pub received: Vec<ReceivedGiftEntry>,
    pub sent: Vec<SentGiftEntry>,
}

// ── Outlayer wire types ──

#[derive(Debug, Deserialize)]
struct PeekResponse {
    token: String,
    balance: String,
    status: String,
}

#[derive(Debug, Deserialize)]
struct ClaimResponse {
    amount_claimed: String,
}

// ── Shared query helpers (used by get_gifts and profile endpoint) ──

pub async fn fetch_received_gifts(
    db: &sqlx::PgPool,
    user_id: i32,
    limit: i64,
) -> Result<Vec<ReceivedGiftEntry>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT u.slug AS from_account_id, u.display_name AS from_display_name,
                  u.avatar_url AS from_avatar_url, pp.days_added, pp.created_at
           FROM premium_purchases pp
           JOIN users u ON u.id = pp.gifted_by_user_id
           WHERE pp.user_id = $1
             AND pp.gifted_by_user_id IS NOT NULL
             AND pp.gifted_by_user_id != pp.user_id
           ORDER BY pp.created_at DESC
           LIMIT $2"#,
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn fetch_sent_gifts(
    db: &sqlx::PgPool,
    user_id: i32,
    limit: i64,
) -> Result<Vec<SentGiftEntry>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT u.slug AS to_account_id, u.display_name AS to_display_name,
                  u.avatar_url AS to_avatar_url, pp.days_added, pp.created_at
           FROM premium_purchases pp
           JOIN users u ON u.id = pp.user_id
           WHERE pp.gifted_by_user_id = $1
             AND pp.user_id != $1
           ORDER BY pp.created_at DESC
           LIMIT $2"#,
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

// ── Handlers ──

/// POST /api/premium/subscribe
/// No auth required — pass JWT to enable gift tracking and notification.
/// If authenticated and account_id != JWT user, the purchase is treated as a gift.
pub async fn subscribe(
    State(state): State<AppState>,
    extensions: axum::http::Extensions,
    Json(req): Json<SubscribeRequest>,
) -> Result<Json<SubscribeResponse>, (StatusCode, String)> {
    if state.config.treasury_agent_key.is_empty() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Premium subscription is not configured".to_string(),
        ));
    }

    // Optional JWT — identifies the buyer for gift tracking
    let buyer_claims = extensions.get::<crate::auth::jwt::Claims>().cloned();

    // Validate recipient exists
    let recipient_id: Option<i32> =
        sqlx::query_scalar("SELECT id FROM users WHERE slug = $1 OR account_id = $1 ORDER BY (slug = $1) DESC LIMIT 1")
            .bind(&req.account_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let recipient_id = recipient_id
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("User '{}' not found", req.account_id)))?;

    let key_hash = hex::encode(Sha256::digest(req.check_key.as_bytes()));

    // ── Peek ──
    let peek_resp = state
        .http_client
        .post(format!("{}/wallet/v1/payment-check/peek", OUTLAYER_API))
        .header(
            "Authorization",
            format!("Bearer {}", state.config.treasury_agent_key),
        )
        .json(&serde_json::json!({ "check_key": req.check_key }))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("OutLayer API error: {}", e)))?;

    if !peek_resp.status().is_success() {
        let text = peek_resp.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_REQUEST, format!("Invalid check: {}", text)));
    }

    let peek: PeekResponse = peek_resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Failed to parse peek response: {}", e)))?;

    if peek.token != USDC_TOKEN && peek.token != USDT_TOKEN {
        return Err((
            StatusCode::BAD_REQUEST,
            "Only USDC and USDT checks are accepted".to_string(),
        ));
    }

    if peek.status != "unclaimed" && peek.status != "partially_claimed" {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Check status is '{}', expected 'unclaimed'", peek.status),
        ));
    }

    let balance: u128 = peek
        .balance
        .parse()
        .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid check balance".to_string()))?;

    let usd = balance / RAW_UNITS_PER_USD;
    if usd < MIN_USD {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Minimum is $10 USDC/USDT (got ~${} USD)", usd),
        ));
    }

    // Determine if this is a gift (buyer is authenticated and different from recipient)
    let gifted_by_user_id: Option<i32> = buyer_claims
        .as_ref()
        .filter(|c| c.user_id != recipient_id)
        .map(|c| c.user_id);

    let is_gift = gifted_by_user_id.is_some();

    // ── Claim ──
    let claim_resp = state
        .http_client
        .post(format!("{}/wallet/v1/payment-check/claim", OUTLAYER_API))
        .header(
            "Authorization",
            format!("Bearer {}", state.config.treasury_agent_key),
        )
        .json(&serde_json::json!({ "check_key": req.check_key }))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("OutLayer claim error: {}", e)))?;

    if !claim_resp.status().is_success() {
        let text = claim_resp.text().await.unwrap_or_default();
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("Failed to claim check: {}", text),
        ));
    }

    let claim: ClaimResponse = claim_resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Failed to parse claim response: {}", e)))?;

    // Compute days from the actual claimed amount (not the peeked balance) to avoid
    // granting more days than received in case of a partial claim race.
    let claimed_amount: u128 = claim
        .amount_claimed
        .parse()
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Invalid claimed amount in response".to_string()))?;
    let days_to_add = usd_to_days(claimed_amount / RAW_UNITS_PER_USD);
    if days_to_add == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Claimed amount too small to grant any premium days".to_string(),
        ));
    }

    // ── Write to DB atomically ──
    let result: Result<chrono::DateTime<chrono::Utc>, sqlx::Error> = sqlx::query_scalar(
        r#"
        WITH ins AS (
            INSERT INTO premium_purchases (user_id, check_key_hash, token, amount, days_added, gifted_by_user_id)
            VALUES ($1, $2, $3, $4, $5, $6)
        )
        UPDATE users
        SET
            premium_since = COALESCE(premium_since, NOW()),
            premium_until = GREATEST(COALESCE(premium_until, NOW()), NOW())
                            + make_interval(days => $5)
        WHERE id = $1
        RETURNING premium_until
        "#,
    )
    .bind(recipient_id)
    .bind(&key_hash)
    .bind(&peek.token)
    .bind(&claim.amount_claimed)
    .bind(days_to_add)
    .bind(gifted_by_user_id)
    .fetch_one(&state.db)
    .await;

    let premium_until = match result {
        Ok(ts) => ts,
        Err(sqlx::Error::Database(ref db_err))
            if db_err.constraint() == Some("premium_purchases_check_key_hash_key") =>
        {
            return Err((
                StatusCode::CONFLICT,
                "This check has already been used for a premium subscription".to_string(),
            ));
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                recipient_id,
                amount = %claim.amount_claimed,
                "DB write failed after successful Outlayer claim — premium not granted"
            );
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)));
        }
    };

    // Send gift notification to recipient
    if let Some(ref bc) = buyer_claims.filter(|c| c.user_id != recipient_id) {
        queries::create_notification(
            &state.db,
            recipient_id,
            "premium_gifted",
            &serde_json::json!({
                "from_account_id": bc.sub,
                "days_added": days_to_add,
                "message": format!("{} gifted you {} days of Premium!", bc.sub, days_to_add),
            }),
        )
        .await
        .ok();
    }

    tracing::info!(
        recipient_id = recipient_id,
        gifted_by_user_id = gifted_by_user_id,
        days_added = days_to_add,
        token = %peek.token,
        amount = %claim.amount_claimed,
        premium_until = %premium_until,
        is_gift = is_gift,
        "Premium subscription activated"
    );

    Ok(Json(SubscribeResponse {
        premium_until: premium_until.to_rfc3339(),
        days_added: days_to_add,
        is_gift,
    }))
}

/// GET /api/premium/gifts/:account_id
/// Returns gift history (received and sent) for the given user. Public endpoint.
pub async fn get_gifts(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
) -> Result<Json<GiftsResponse>, (StatusCode, String)> {
    let user_id: Option<i32> =
        sqlx::query_scalar("SELECT id FROM users WHERE slug = $1 OR account_id = $1 ORDER BY (slug = $1) DESC LIMIT 1")
            .bind(&account_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_id = user_id
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("User '{}' not found", account_id)))?;

    let (received, sent) = tokio::try_join!(
        fetch_received_gifts(&state.db, user_id, 20),
        fetch_sent_gifts(&state.db, user_id, 20),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(GiftsResponse { received, sent }))
}
