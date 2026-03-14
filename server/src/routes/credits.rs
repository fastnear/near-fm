use axum::{
    extract::{Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{auth::jwt::require_auth, AppState};

const OUTLAYER_API: &str = "https://api.outlayer.fastnear.com";

// Accepted stablecoin contracts (both 6 decimals)
const USDC_TOKEN: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT_TOKEN: &str = "usdt.tether-token.near";

// 1 USD = 1_000_000 raw units = 100 credits → 1 credit = 10_000 raw units
const RAW_UNITS_PER_CREDIT: u128 = 10_000;

// ── Topup (public, no auth) ──

#[derive(Debug, Deserialize)]
pub struct TopupRequest {
    pub check_key: String,
    pub account_id: String,
}

#[derive(Debug, Serialize)]
pub struct TopupResponse {
    pub credits_added: i32,
    pub new_balance: i32,
}

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

pub async fn topup(
    State(state): State<AppState>,
    Json(req): Json<TopupRequest>,
) -> Result<Json<TopupResponse>, (StatusCode, String)> {
    if state.config.treasury_agent_key.is_empty() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Credits top-up is not configured".to_string()));
    }

    // Validate account exists
    let user_id: Option<i32> = sqlx::query_scalar(
        "SELECT id FROM users WHERE slug = $1 OR account_id = $1",
    )
    .bind(&req.account_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let user_id = user_id.ok_or_else(|| {
        (StatusCode::NOT_FOUND, format!("User '{}' not found", req.account_id))
    })?;

    let key_hash = hex::encode(Sha256::digest(req.check_key.as_bytes()));

    // Peek check via OutLayer API
    let peek_resp = state
        .http_client
        .post(format!("{}/wallet/v1/payment-check/peek", OUTLAYER_API))
        .header("Authorization", format!("Bearer {}", state.config.treasury_agent_key))
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

    // Validate token
    if peek.token != USDC_TOKEN && peek.token != USDT_TOKEN {
        return Err((StatusCode::BAD_REQUEST, "Only USDC and USDT checks are accepted".to_string()));
    }

    // Validate status and balance
    if peek.status != "unclaimed" && peek.status != "partially_claimed" {
        return Err((StatusCode::BAD_REQUEST, format!("Check status is '{}', expected 'unclaimed'", peek.status)));
    }

    let balance: u128 = peek.balance.parse().map_err(|_| {
        (StatusCode::BAD_REQUEST, "Invalid check balance".to_string())
    })?;

    if balance == 0 {
        return Err((StatusCode::BAD_REQUEST, "Check has zero balance".to_string()));
    }

    let credits = (balance / RAW_UNITS_PER_CREDIT) as i32;
    if credits == 0 {
        return Err((StatusCode::BAD_REQUEST, "Check amount too small (minimum $0.01 = 1 credit)".to_string()));
    }

    // Claim check via OutLayer API
    let claim_resp = state
        .http_client
        .post(format!("{}/wallet/v1/payment-check/claim", OUTLAYER_API))
        .header("Authorization", format!("Bearer {}", state.config.treasury_agent_key))
        .json(&serde_json::json!({ "check_key": req.check_key }))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("OutLayer claim error: {}", e)))?;

    if !claim_resp.status().is_success() {
        let text = claim_resp.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_GATEWAY, format!("Failed to claim check: {}", text)));
    }

    let claim: ClaimResponse = claim_resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Failed to parse claim response: {}", e)))?;

    // Credit user atomically — UNIQUE on check_key_hash prevents double-credit
    let result: Result<i32, sqlx::Error> = sqlx::query_scalar(
        r#"
        WITH ins AS (
            INSERT INTO credit_topups (user_id, check_key_hash, token, amount, credits_added)
            VALUES ($1, $2, $3, $4, $5)
        )
        UPDATE users SET credit_balance = credit_balance + $5
        WHERE id = $1
        RETURNING credit_balance
        "#,
    )
    .bind(user_id)
    .bind(&key_hash)
    .bind(&peek.token)
    .bind(&claim.amount_claimed)
    .bind(credits)
    .fetch_one(&state.db)
    .await;

    let new_balance = match result {
        Ok(b) => b,
        Err(sqlx::Error::Database(ref db_err)) if db_err.constraint() == Some("credit_topups_check_key_hash_key") => {
            return Err((StatusCode::CONFLICT, "This check has already been used for top-up".to_string()));
        }
        Err(e) => {
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", e)));
        }
    };

    tracing::info!(
        account_id = %req.account_id,
        user_id = user_id,
        credits = credits,
        token = %peek.token,
        amount = %claim.amount_claimed,
        "Credit top-up successful"
    );

    Ok(Json(TopupResponse {
        credits_added: credits,
        new_balance,
    }))
}

// ── Balance (authenticated) ──

#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub credit_balance: i32,
}

pub async fn balance(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<BalanceResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let credit_balance: i32 = sqlx::query_scalar(
        "SELECT credit_balance FROM users WHERE id = $1",
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(BalanceResponse { credit_balance }))
}

// ── History (authenticated) ──

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TopupRecord {
    pub token: String,
    pub amount: String,
    pub credits_added: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn history(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Vec<TopupRecord>>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let limit = q.limit.unwrap_or(50).min(100);

    let records = sqlx::query_as::<_, TopupRecord>(
        "SELECT token, amount, credits_added, created_at FROM credit_topups WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    )
    .bind(claims.user_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(records))
}

// ── Usage (authenticated) ──

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UsageRecord {
    pub credits_spent: i32,
    pub from_daily: i32,
    pub from_purchased: i32,
    pub action: String,
    pub reference_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn usage(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Vec<UsageRecord>>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let limit = q.limit.unwrap_or(50).min(100);

    let records = sqlx::query_as::<_, UsageRecord>(
        "SELECT credits_spent, from_daily, from_purchased, action, reference_id, created_at \
         FROM credit_usage WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    )
    .bind(claims.user_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(records))
}

// ── Pricing (public) ──

#[derive(Debug, Serialize)]
pub struct PricingResponse {
    pub credits_per_usd: i32,
    pub min_topup_usd: &'static str,
    pub costs: Vec<PricingItem>,
    pub accepted_tokens: Vec<AcceptedToken>,
}

#[derive(Debug, Serialize)]
pub struct PricingItem {
    pub action: &'static str,
    pub credits: i32,
    pub usd: &'static str,
}

#[derive(Debug, Serialize)]
pub struct AcceptedToken {
    pub name: &'static str,
    pub contract: &'static str,
    pub decimals: u8,
}

pub async fn pricing() -> Json<PricingResponse> {
    Json(PricingResponse {
        credits_per_usd: 100,
        min_topup_usd: "0.01",
        costs: vec![
            PricingItem { action: "generate_song", credits: 12, usd: "0.12" },
            PricingItem { action: "generate_lyrics", credits: 1, usd: "0.01" },
        ],
        accepted_tokens: vec![
            AcceptedToken { name: "USDC", contract: USDC_TOKEN, decimals: 6 },
            AcceptedToken { name: "USDT", contract: USDT_TOKEN, decimals: 6 },
        ],
    })
}
