use axum::{
    extract::{Path, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::Digest;

use crate::{auth::jwt::require_auth, db::queries, AppState};

use super::outlayer;
const TIP_COMMISSION_BPS: u64 = 0;    // 0% — tips go fully to recipient
const BOUNTY_COMMISSION_BPS: u64 = 500; // 5% — platform fee on bounty awards

/// Accepted tokens for balance operations. Add more here to support additional stablecoins.
const ACCEPTED_TOKENS: &[(&str, &str)] = &[
    ("USDC", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"),
    // ("USDT", "usdt.tether-token.near"),
];

/// Default token for tips, bounties, balance display.
pub fn default_token() -> &'static str {
    ACCEPTED_TOKENS[0].1
}

// ── Auto-provision OutLayer wallet ──

/// Ensure user has an OutLayer wallet. Creates one if missing.
/// Called on login — every user gets a wallet from day one.
pub async fn ensure_wallet(pool: &sqlx::PgPool, http_client: &reqwest::Client, user_id: i32) {
    // Check if already has wallet
    let has_wallet: bool = sqlx::query_scalar(
        "SELECT outlayer_api_key IS NOT NULL FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(true); // on error, assume has wallet (don't block login)

    if has_wallet {
        return;
    }

    // Register new OutLayer wallet
    let data = match register_outlayer_wallet(http_client).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(user_id, "Failed to register OutLayer wallet: {}", e);
            return;
        }
    };

    let api_key = data["api_key"].as_str().unwrap_or("");
    let near_account = data["near_account_id"].as_str().unwrap_or("");

    if api_key.is_empty() {
        return;
    }

    let _ = sqlx::query(
        "UPDATE users SET outlayer_api_key = $1, outlayer_near_account = $2 WHERE id = $3 AND outlayer_api_key IS NULL"
    )
    .bind(api_key)
    .bind(near_account)
    .bind(user_id)
    .execute(pool)
    .await;

    tracing::info!(user_id, "OutLayer wallet auto-provisioned");
}

// ── Backup / Restore ──

#[derive(Deserialize)]
pub struct BackupRequest {
    pub api_key: String,
    pub near_account_id: String,
}

#[derive(Serialize)]
pub struct RestoreResponse {
    pub api_key: Option<String>,
    pub near_account_id: Option<String>,
}

/// POST /api/wallet/backup — save OutLayer api_key to DB (backup from client).
/// NOTE: api_key is stored plain text. For production with significant balances,
/// encrypt with AES-256 using a master key from environment.
pub async fn backup(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<BackupRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Basic validation
    if !req.api_key.starts_with("wk_") || req.api_key.len() < 20 {
        return Err((StatusCode::BAD_REQUEST, "Invalid API key format".to_string()));
    }

    // Only save if user doesn't already have a wallet (prevent overwrite)
    let has_wallet: bool = sqlx::query_scalar(
        "SELECT outlayer_api_key IS NOT NULL FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if has_wallet {
        // Already has a wallet — don't overwrite
        return Ok(StatusCode::OK);
    }

    sqlx::query(
        "UPDATE users SET outlayer_api_key = $1, outlayer_near_account = $2 WHERE id = $3 AND outlayer_api_key IS NULL"
    )
    .bind(&req.api_key)
    .bind(&req.near_account_id)
    .bind(claims.user_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!(user_id = claims.user_id, "OutLayer wallet backed up");

    Ok(StatusCode::OK)
}

/// GET /api/wallet/restore — retrieve OutLayer api_key from DB
pub async fn restore(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<RestoreResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let row: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT outlayer_api_key, outlayer_near_account FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(RestoreResponse {
        api_key: row.0,
        near_account_id: row.1,
    }))
}

// ── Balance (proxy to OutLayer) ──

#[derive(Serialize)]
pub struct BalanceResponse {
    pub balance_usdc: String,
    pub balance_usdc_formatted: String,
}

/// GET /api/wallet/balance — get user's OutLayer intents balance
pub async fn balance(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<BalanceResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let Some(api_key) = api_key else {
        return Ok(Json(BalanceResponse {
            balance_usdc: "0".to_string(),
            balance_usdc_formatted: "0.00".to_string(),
        }));
    };

    // Query OutLayer for USDC intents balance
    let url = format!(
        "{}/wallet/v1/balance?token={}&source=intents",
        outlayer::api_base(), default_token()
    );

    let resp = state.http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("OutLayer request failed: {}", e)))?;

    if !resp.status().is_success() {
        return Ok(Json(BalanceResponse {
            balance_usdc: "0".to_string(),
            balance_usdc_formatted: "0.00".to_string(),
        }));
    }

    let data: serde_json::Value = resp.json().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("OutLayer parse failed: {}", e)))?;

    let raw_balance = data["balance"].as_str().unwrap_or("0").to_string();
    let raw_num: u64 = raw_balance.parse().unwrap_or(0);
    let cents = raw_num / 10_000; // floor to cents
    let formatted = format!("{}.{:02}", cents / 100, cents % 100);

    Ok(Json(BalanceResponse {
        balance_usdc: raw_balance,
        balance_usdc_formatted: formatted,
    }))
}

// ── Tips via payment checks ──

#[derive(Deserialize)]
pub struct SendTipRequest {
    pub song_uuid: Option<String>,       // tip a song
    pub profile_slug: Option<String>,    // tip a profile (one of the two required)
    pub amount_cents: Option<u32>,       // e.g. 50 = $0.50
    pub amount_raw: Option<String>,      // exact raw USDC units (6 decimals) — takes precedence
}

#[derive(Serialize)]
pub struct SendTipResponse {
    pub tip_id: i32,
    pub amount_cents: u32,
    pub commission_cents: u32,
}

/// POST /api/tips/send — tip a song using OutLayer payment check (chain-agnostic).
/// Deducts from sender's intents balance, credits to recipient's intents balance.
pub async fn send_tip(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<SendTipRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Determine raw amount: amount_raw takes precedence over amount_cents
    let raw_amount: u64 = if let Some(ref raw) = req.amount_raw {
        raw.parse().map_err(|_| (StatusCode::BAD_REQUEST, "Invalid amount_raw".to_string()))?
    } else if let Some(cents) = req.amount_cents {
        (cents as u64) * 10_000
    } else {
        return Err((StatusCode::BAD_REQUEST, "amount_cents or amount_raw required".to_string()));
    };
    let amount_cents_for_db = (raw_amount / 10_000) as u32;

    // Validation
    if raw_amount < 10_000 {
        return Err((StatusCode::BAD_REQUEST, "Minimum tip is $0.01".to_string()));
    }
    if raw_amount > 1_000_000_000 {
        return Err((StatusCode::BAD_REQUEST, "Maximum tip is $1000".to_string()));
    }

    // Check if banned
    let is_banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Account banned".to_string()));
    }

    // Resolve recipient: either from song or from profile
    let (song_id, recipient_id, tip_context, song_title) = if let Some(ref song_uuid) = req.song_uuid {
        let song = queries::get_song_by_uuid(&state.db, song_uuid)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))?;
        if song.uploader_id == claims.user_id {
            return Err((StatusCode::BAD_REQUEST, "Cannot tip your own song".to_string()));
        }
        let title = song.title.clone();
        (Some(song.id), song.uploader_id, format!("song:{}", song_uuid), Some(title))
    } else if let Some(ref profile_slug) = req.profile_slug {
        let recipient: Option<(i32,)> = sqlx::query_as(
            "SELECT id FROM users WHERE slug = $1"
        )
        .bind(profile_slug)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let Some((rid,)) = recipient else {
            return Err((StatusCode::NOT_FOUND, "User not found".to_string()));
        };
        if rid == claims.user_id {
            return Err((StatusCode::BAD_REQUEST, "Cannot tip yourself".to_string()));
        }
        (None, rid, format!("profile:{}", profile_slug), None)
    } else {
        return Err((StatusCode::BAD_REQUEST, "Either song_uuid or profile_slug required".to_string()));
    };

    // Get both OutLayer api_keys
    let sender_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let sender_key = sender_key.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "No wallet found. Please top up your balance first.".to_string())
    })?;

    let mut recipient_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(recipient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Auto-provision wallet for recipient if missing
    if recipient_key.is_none() {
        ensure_wallet(&state.db, &state.http_client, recipient_id).await;
        recipient_key = sqlx::query_scalar(
            "SELECT outlayer_api_key FROM users WHERE id = $1"
        )
        .bind(recipient_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let recipient_key = recipient_key.ok_or_else(|| {
        (StatusCode::BAD_GATEWAY, "Failed to create wallet for recipient. Try again later.".to_string())
    })?;

    // Check sender's balance before creating check
    let balance_resp = outlayer_request(
        &state.http_client,
        &sender_key,
        "GET",
        &format!("/wallet/v1/balance?token={}&source=intents", default_token()),
        None,
    ).await.map_err(|e| (StatusCode::BAD_GATEWAY, format!("Balance check failed: {}", e)))?;

    let sender_balance: u64 = balance_resp["balance"].as_str()
        .unwrap_or("0")
        .parse()
        .unwrap_or(0);
    let raw_amount = adjust_for_dust(sender_balance, raw_amount);

    if sender_balance < raw_amount {
        return Err((StatusCode::BAD_REQUEST, "Insufficient balance. Top up first.".to_string()));
    }

    // Calculate amounts using raw units (6 decimals) — after the dust adjustment,
    // so the recipient's claim never exceeds the check.
    let commission_raw = raw_amount * TIP_COMMISSION_BPS / 10_000;
    let raw_recipient = raw_amount - commission_raw;

    let mut legs = vec![outlayer::Leg {
        api_key: recipient_key,
        amount: Some(raw_recipient.to_string()),
        label: "recipient".to_string(),
    }];
    if commission_raw > 0 && !state.config.treasury_agent_key.is_empty() {
        legs.push(outlayer::Leg {
            api_key: state.config.treasury_agent_key.clone(),
            amount: None,
            label: "commission".to_string(),
        });
    }

    // Payment + DB record run detached: they finish even if the client disconnects.
    let st = state.clone();
    let tipper_id = claims.user_id;
    let tipper_sub = claims.sub.clone();
    let flow = async move {
    let state = st;
    outlayer::pay_via_check(
        &state.http_client,
        &sender_key,
        default_token(),
        &raw_amount.to_string(),
        &format!("Tip: {}", tip_context),
        "tip",
        &legs,
        false,
    )
    .await
    .map_err(|(_, e)| (StatusCode::BAD_GATEWAY, format!("Tip failed: {}", e)))?;

    // Record in DB
    let tip_id = sqlx::query_scalar::<_, i32>(
        r#"INSERT INTO tips (song_id, tipper_id, recipient_id, amount_usd_cents, payment_method)
           VALUES ($1, $2, $3, $4, 'balance')
           RETURNING id"#,
    )
    .bind(song_id)
    .bind(tipper_id)
    .bind(recipient_id)
    .bind(amount_cents_for_db as i32)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(tipper_id, recipient_id, raw_amount, "Tip paid but DB record failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    // Update USD tip totals
    let recipient_cents_for_db = (raw_recipient / 10_000) as i32;
    if let Some(sid) = song_id {
        sqlx::query("UPDATE songs SET total_tips_usd_cents = total_tips_usd_cents + $1 WHERE id = $2")
            .bind(recipient_cents_for_db)
            .bind(sid)
            .execute(&state.db)
            .await
            .ok();
    }

    sqlx::query("UPDATE users SET total_tips_received_usd_cents = total_tips_received_usd_cents + $1 WHERE id = $2")
        .bind(recipient_cents_for_db)
        .bind(recipient_id)
        .execute(&state.db)
        .await
        .ok();

    // Notification
    queries::create_notification(
        &state.db,
        recipient_id,
        "tip_received",
        &serde_json::json!({
            "song_uuid": req.song_uuid,
            "song_title": song_title,
            "profile_slug": req.profile_slug,
            "from_account": tipper_sub,
            "amount_usd_cents": amount_cents_for_db,
        }),
    )
    .await
    .ok();

    tracing::info!(
        tip_id,
        sender = tipper_id,
        recipient = recipient_id,
        amount_cents = amount_cents_for_db,
        raw_amount = raw_amount,
        context = %tip_context,
        "USD tip sent via payment check"
    );

    Ok(SendTipResponse {
        tip_id,
        amount_cents: amount_cents_for_db,
        commission_cents: (commission_raw / 10_000) as u32,
    })
    };

    finish(flow, "Tip is processing and will arrive shortly.").await
}

// ── Bounties via dedicated OutLayer wallet ──

#[derive(Deserialize)]
pub struct CreateBountyRequest {
    pub title: String,
    pub description: String,
    pub amount_cents: u32,
    pub language_id: Option<i32>,
}

/// POST /api/bounties/create — create a song request with USD bounty.
/// Creates a dedicated OutLayer wallet for the bounty (server holds the key).
/// Transfers initial funds from user's wallet via payment check.
pub async fn create_bounty(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<CreateBountyRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if req.amount_cents < 100 {
        return Err((StatusCode::BAD_REQUEST, "Minimum bounty is $1.00".to_string()));
    }
    if req.title.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Title required".to_string()));
    }

    let is_banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(claims.user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if is_banned {
        return Err((StatusCode::FORBIDDEN, "Account banned".to_string()));
    }

    let sender_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let sender_key = sender_key.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "No wallet found. Please top up your balance first.".to_string())
    })?;

    let raw_amount = (req.amount_cents as u64) * 10_000;

    // Check sender balance
    let balance_resp = outlayer_request(
        &state.http_client, &sender_key, "GET",
        &format!("/wallet/v1/balance?token={}&source=intents", default_token()), None,
    ).await.map_err(|e| (StatusCode::BAD_GATEWAY, format!("Balance check failed: {}", e)))?;

    let sender_balance: u64 = balance_resp["balance"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let raw_amount = adjust_for_dust(sender_balance, raw_amount);
    if sender_balance < raw_amount {
        return Err((StatusCode::BAD_REQUEST, "Insufficient balance. Top up first.".to_string()));
    }

    // 1. Create dedicated bounty wallet (server-only key)
    let bounty_wallet = register_outlayer_wallet(&state.http_client)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Failed to create bounty wallet: {}", e)))?;

    let bounty_key = bounty_wallet["api_key"].as_str()
        .ok_or((StatusCode::BAD_GATEWAY, "Missing bounty wallet key".to_string()))?
        .to_string();
    let bounty_near_account = bounty_wallet["near_account_id"].as_str().unwrap_or("").to_string();

    // 2. Transfer funds: sender → check → bounty wallet claim, then create
    // the request + escrow. Detached: finishes even if the client disconnects.
    let st = state.clone();
    let requester_id = claims.user_id;
    let flow = async move {
    let state = st;
    outlayer::pay_via_check(
        &state.http_client,
        &sender_key,
        default_token(),
        &raw_amount.to_string(),
        &format!("Bounty: {}", req.title),
        "bounty-create",
        &[outlayer::Leg { api_key: bounty_key.clone(), amount: None, label: "escrow".to_string() }],
        false,
    )
    .await
    .map_err(|(_, e)| (StatusCode::BAD_GATEWAY, format!("Failed to fund bounty: {}", e)))?;

    // 3. Create request + escrow in DB
    let uuid = uuid::Uuid::new_v4().to_string();
    let title = super::truncate_str(&req.title, 200);
    let description = super::truncate_str(&req.description, 5000);

    let request_id: i32 = sqlx::query_scalar(
        r#"INSERT INTO song_requests
            (uuid, requester_id, title, description, bounty_amount_yocto, bounty_tx_hash,
             bounty_usd_cents, bounty_payment_method, language_id, expires_at)
           VALUES ($1, $2, $3, $4, '0', NULL, $5, 'balance', $6, NOW() + INTERVAL '30 days')
           RETURNING id"#,
    )
    .bind(&uuid)
    .bind(requester_id)
    .bind(&title)
    .bind(&description)
    .bind(req.amount_cents as i32)
    .bind(req.language_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(requester_id, bounty_near_account = %bounty_near_account, "Bounty funded but request insert failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    sqlx::query(
        "INSERT INTO bounty_escrow (request_id, amount_cents, outlayer_api_key, outlayer_near_account) VALUES ($1, $2, $3, $4)"
    )
    .bind(request_id)
    .bind(req.amount_cents as i32)
    .bind(&bounty_key)
    .bind(&bounty_near_account)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(request_id, bounty_near_account = %bounty_near_account, "Bounty funded but escrow insert failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    // Track contribution
    sqlx::query(
        "INSERT INTO bounty_contributions (escrow_id, user_id, amount_cents) VALUES ((SELECT id FROM bounty_escrow WHERE request_id = $1), $2, $3)"
    )
    .bind(request_id)
    .bind(requester_id)
    .bind(req.amount_cents as i32)
    .execute(&state.db)
    .await
    .ok();

    tracing::info!(request_id, amount_cents = req.amount_cents, "USD bounty created with dedicated wallet");

    Ok(serde_json::json!({
        "uuid": uuid,
        "request_id": request_id,
        "bounty_usd_cents": req.amount_cents,
    }))
    };

    finish(flow, "Bounty funding is processing; the request will appear shortly.").await
}

#[derive(Deserialize)]
pub struct TopUpBountyRequest {
    pub amount_cents: u32,
}

/// POST /api/bounties/:uuid/topup — anyone can add funds to an existing bounty.
pub async fn topup_bounty(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<TopUpBountyRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if req.amount_cents < 10 {
        return Err((StatusCode::BAD_REQUEST, "Minimum top-up is $0.10".to_string()));
    }

    let sender_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let sender_key = sender_key.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "No wallet found. Top up your balance first.".to_string())
    })?;

    // Get bounty escrow
    let escrow: Option<(i32, String)> = sqlx::query_as(
        "SELECT be.id, be.outlayer_api_key FROM bounty_escrow be JOIN song_requests sr ON sr.id = be.request_id WHERE sr.uuid = $1 AND be.status = 'held'"
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let Some((escrow_id, bounty_key)) = escrow else {
        return Err((StatusCode::NOT_FOUND, "No active bounty found".to_string()));
    };

    let raw_amount = (req.amount_cents as u64) * 10_000;

    // Check sender balance
    let balance_resp = outlayer_request(
        &state.http_client, &sender_key, "GET",
        &format!("/wallet/v1/balance?token={}&source=intents", default_token()), None,
    ).await.map_err(|e| (StatusCode::BAD_GATEWAY, format!("Balance check failed: {}", e)))?;

    let sender_balance: u64 = balance_resp["balance"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let raw_amount = adjust_for_dust(sender_balance, raw_amount);
    if sender_balance < raw_amount {
        return Err((StatusCode::BAD_REQUEST, "Insufficient balance".to_string()));
    }

    // Transfer: sender → check → bounty wallet, then record. Detached.
    let st = state.clone();
    let contributor_id = claims.user_id;
    let flow = async move {
    let state = st;
    outlayer::pay_via_check(
        &state.http_client,
        &sender_key,
        default_token(),
        &raw_amount.to_string(),
        "Bounty top-up",
        "bounty-topup",
        &[outlayer::Leg { api_key: bounty_key, amount: None, label: "escrow".to_string() }],
        false,
    )
    .await
    .map_err(|(_, e)| (StatusCode::BAD_GATEWAY, format!("Top-up failed: {}", e)))?;

    // Update escrow amount + track contribution
    sqlx::query("UPDATE bounty_escrow SET amount_cents = amount_cents + $1 WHERE id = $2")
        .bind(req.amount_cents as i32)
        .bind(escrow_id)
        .execute(&state.db)
        .await
        .ok();

    sqlx::query("UPDATE song_requests SET bounty_usd_cents = COALESCE(bounty_usd_cents, 0) + $1 WHERE uuid = $2")
        .bind(req.amount_cents as i32)
        .bind(&uuid)
        .execute(&state.db)
        .await
        .ok();

    sqlx::query(
        "INSERT INTO bounty_contributions (escrow_id, user_id, amount_cents) VALUES ($1, $2, $3)"
    )
    .bind(escrow_id)
    .bind(contributor_id)
    .bind(req.amount_cents as i32)
    .execute(&state.db)
    .await
    .ok();

    tracing::info!(escrow_id, user_id = contributor_id, amount_cents = req.amount_cents, "Bounty top-up");

    Ok(serde_json::json!({ "status": "topped_up", "amount_cents": req.amount_cents }))
    };

    finish(flow, "Top-up is processing and will be added to the bounty shortly.").await
}

/// POST /api/bounties/:uuid/award — award bounty to winner.
/// Server transfers from bounty wallet to recipient's wallet.
pub async fn award_bounty(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
    Json(req): Json<serde_json::Value>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let awarded_song_id = req["awarded_song_id"].as_i64()
        .ok_or((StatusCode::BAD_REQUEST, "awarded_song_id required".to_string()))? as i32;

    let request: (i32, i32, String) = sqlx::query_as(
        "SELECT id, requester_id, status FROM song_requests WHERE uuid = $1"
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Request not found".to_string()))?;

    if request.1 != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not the request owner".to_string()));
    }
    if request.2 != "open" {
        return Err((StatusCode::BAD_REQUEST, "Request is not open".to_string()));
    }

    let escrow: Option<(i32, i32, String)> = sqlx::query_as(
        "SELECT id, amount_cents, outlayer_api_key FROM bounty_escrow WHERE request_id = $1 AND status = 'held'"
    )
    .bind(request.0)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let Some((escrow_id, amount_cents, bounty_key)) = escrow else {
        return Err((StatusCode::BAD_REQUEST, "No active escrow".to_string()));
    };

    // Verify song is a submission to this request
    let submission_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM request_submissions WHERE request_id = $1 AND song_id = $2)"
    )
    .bind(request.0)
    .bind(awarded_song_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    if !submission_exists {
        return Err((StatusCode::BAD_REQUEST, "This song was not submitted to this request".to_string()));
    }

    // Get recipient
    let recipient_id: i32 = sqlx::query_scalar("SELECT uploader_id FROM songs WHERE id = $1")
        .bind(awarded_song_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let recipient_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(recipient_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let recipient_key = recipient_key.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "Winner hasn't set up a wallet yet".to_string())
    })?;

    // Calculate: bounty wallet → check → recipient claim (95%) + treasury claim (5%)
    let commission_cents = (amount_cents as u64 * BOUNTY_COMMISSION_BPS / 10_000) as i32;
    let recipient_cents = amount_cents - commission_cents;
    let raw_amount = (amount_cents as u64) * 10_000;
    let raw_recipient = (recipient_cents as u64) * 10_000;

    // Lock the escrow while the payout runs (it may outlive this request).
    lock_escrow(&state.db, escrow_id).await?;

    let mut legs = vec![outlayer::Leg {
        api_key: recipient_key,
        amount: Some(raw_recipient.to_string()),
        label: "winner".to_string(),
    }];
    if commission_cents > 0 && !state.config.treasury_agent_key.is_empty() {
        legs.push(outlayer::Leg {
            api_key: state.config.treasury_agent_key.clone(),
            amount: None,
            label: "commission".to_string(),
        });
    }

    let st = state.clone();
    let flow = async move {
    let state = st;
    if let Err(e) = outlayer::pay_via_check(
        &state.http_client,
        &bounty_key,
        default_token(),
        &raw_amount.to_string(),
        "Bounty award",
        "bounty-award",
        &legs,
        false,
    )
    .await
    {
        let (in_flight, e) = e;
        if in_flight {
            // Money is moving: keep the escrow locked for manual reconciliation.
            tracing::error!(escrow_id, "Award still in flight after follow window: {}", e);
            return Err((StatusCode::SERVICE_UNAVAILABLE, "Payout is still settling; it will complete shortly.".to_string()));
        }
        unlock_escrow(&state.db, escrow_id).await;
        return Err((StatusCode::BAD_GATEWAY, format!("Award failed: {}", e)));
    }

    // Update DB
    sqlx::query("UPDATE bounty_escrow SET status = 'awarded', resolved_at = NOW() WHERE id = $1")
        .bind(escrow_id).execute(&state.db).await.ok();
    sqlx::query("UPDATE song_requests SET status = 'awarded', awarded_song_id = $1, updated_at = NOW() WHERE uuid = $2")
        .bind(awarded_song_id).bind(&uuid).execute(&state.db).await.ok();

    queries::create_notification(&state.db, recipient_id, "bounty_awarded", &serde_json::json!({
        "request_uuid": uuid, "bounty_usd_cents": amount_cents,
    })).await.ok();

    tracing::info!(recipient_id, amount_cents, "USD bounty awarded from dedicated wallet");

    Ok(serde_json::json!({ "status": "awarded", "recipient_cents": recipient_cents }))
    };

    finish(flow, "Award payout is processing and will arrive shortly.").await
}

/// POST /api/bounties/:uuid/withdraw — cancel bounty, refund contributors (with penalty).
pub async fn withdraw_bounty(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    extensions: Extensions,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let request: (i32, i32, String) = sqlx::query_as(
        "SELECT id, requester_id, status FROM song_requests WHERE uuid = $1"
    )
    .bind(&uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Request not found".to_string()))?;

    if request.1 != claims.user_id {
        return Err((StatusCode::FORBIDDEN, "Not the request owner".to_string()));
    }
    if request.2 != "open" {
        return Err((StatusCode::BAD_REQUEST, "Request is not open".to_string()));
    }

    let escrow: Option<(i32, i32, String)> = sqlx::query_as(
        "SELECT id, amount_cents, outlayer_api_key FROM bounty_escrow WHERE request_id = $1 AND status = 'held'"
    )
    .bind(request.0)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let Some((escrow_id, amount_cents, bounty_key)) = escrow else {
        return Err((StatusCode::BAD_REQUEST, "No active escrow".to_string()));
    };

    // 20% penalty → treasury, 80% refunded proportionally to contributors
    let penalty_cents = (amount_cents as u64 * 2000 / 10_000) as i32;
    let refund_pool = amount_cents - penalty_cents;
    let raw_total = (amount_cents as u64) * 10_000;

    let contributions: Vec<(i32, i32)> = sqlx::query_as(
        "SELECT user_id, amount_cents FROM bounty_contributions WHERE escrow_id = $1"
    )
    .bind(escrow_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut legs = Vec::new();
    if penalty_cents > 0 && !state.config.treasury_agent_key.is_empty() {
        legs.push(outlayer::Leg {
            api_key: state.config.treasury_agent_key.clone(),
            amount: Some(((penalty_cents as u64) * 10_000).to_string()),
            label: "penalty".to_string(),
        });
    }
    for (contributor_id, contrib_cents) in &contributions {
        let refund_share = (*contrib_cents as u64) * (refund_pool as u64) / (amount_cents as u64);
        if refund_share == 0 { continue; }
        let contributor_key: Option<String> = sqlx::query_scalar(
            "SELECT outlayer_api_key FROM users WHERE id = $1"
        )
        .bind(contributor_id)
        .fetch_one(&state.db)
        .await
        .ok()
        .flatten();
        match contributor_key {
            Some(ckey) => legs.push(outlayer::Leg {
                api_key: ckey,
                amount: Some((refund_share * 10_000).to_string()),
                label: format!("refund-{}", contributor_id),
            }),
            None => tracing::warn!(contributor_id, "Bounty refund skipped: contributor has no wallet"),
        }
    }
    if legs.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Nothing to refund".to_string()));
    }

    // Lock the escrow while the refunds run (they may outlive this request).
    lock_escrow(&state.db, escrow_id).await?;

    let st = state.clone();
    let flow = async move {
    let state = st;
    // What is left on the check (a contributor without a wallet, a failed
    // share) goes back to the bounty wallet rather than sitting in the check.
    if let Err(e) = outlayer::pay_via_check(
        &state.http_client,
        &bounty_key,
        default_token(),
        &raw_total.to_string(),
        "Bounty withdrawal",
        "bounty-withdraw",
        &legs,
        true,
    )
    .await
    {
        let (in_flight, e) = e;
        if in_flight {
            // Money is moving: keep the escrow locked for manual reconciliation.
            tracing::error!(escrow_id, "Withdrawal still in flight after follow window: {}", e);
            return Err((StatusCode::SERVICE_UNAVAILABLE, "Payout is still settling; it will complete shortly.".to_string()));
        }
        unlock_escrow(&state.db, escrow_id).await;
        return Err((StatusCode::BAD_GATEWAY, format!("Withdrawal failed: {}", e)));
    }

    // Update DB
    sqlx::query("UPDATE bounty_escrow SET status = 'refunded', resolved_at = NOW() WHERE id = $1")
        .bind(escrow_id).execute(&state.db).await.ok();
    sqlx::query("UPDATE song_requests SET status = 'withdrawn', updated_at = NOW() WHERE uuid = $1")
        .bind(&uuid).execute(&state.db).await.ok();

    tracing::info!(escrow_id, amount_cents, refund_pool, penalty_cents, "USD bounty withdrawn, contributors refunded");

    Ok(serde_json::json!({
        "status": "withdrawn",
        "refund_cents": refund_pool,
        "penalty_cents": penalty_cents,
    }))
    };

    finish(flow, "Refunds are processing and will arrive shortly.").await
}

/// Mark an escrow as being paid out; refuses if it is not `held` (a payout is
/// already running, or it was resolved).
async fn lock_escrow(db: &sqlx::PgPool, escrow_id: i32) -> Result<(), (StatusCode, String)> {
    let locked: Option<i32> = sqlx::query_scalar(
        "UPDATE bounty_escrow SET status = 'paying' WHERE id = $1 AND status = 'held' RETURNING id"
    )
    .bind(escrow_id)
    .fetch_optional(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    locked.map(|_| ()).ok_or((StatusCode::CONFLICT, "A payout for this bounty is already in progress".to_string()))
}

/// Return an escrow to `held` after a payout failed for good (funds reclaimed).
async fn unlock_escrow(db: &sqlx::PgPool, escrow_id: i32) {
    sqlx::query("UPDATE bounty_escrow SET status = 'held' WHERE id = $1 AND status = 'paying'")
        .bind(escrow_id)
        .execute(db)
        .await
        .ok();
}

/// Await a detached money flow for up to `outlayer::ROUTE_WAIT`; past that,
/// answer 202 and let it finish (and write its own DB rows) in the background.
async fn finish<T: Serialize + Send + 'static>(
    flow: impl std::future::Future<Output = Result<T, (StatusCode, String)>> + Send + 'static,
    processing_message: &str,
) -> Result<axum::response::Response, (StatusCode, String)> {
    use axum::response::IntoResponse;
    match outlayer::detached(flow, outlayer::ROUTE_WAIT).await {
        Some(Ok(v)) => Ok(Json(v).into_response()),
        Some(Err(e)) => Err(e),
        None => Ok(outlayer::processing_response(processing_message)),
    }
}

// ── Credits from balance ──

#[derive(Deserialize)]
pub struct BuyCreditsRequest {
    pub amount_cents: u32, // $1 = 100 credits
}

/// POST /api/credits/buy-from-balance — buy AI credits from OutLayer balance.
/// 1 credit = $0.01. Credits cannot be withdrawn.
pub async fn buy_credits(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<BuyCreditsRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if req.amount_cents < 1 {
        return Err((StatusCode::BAD_REQUEST, "Minimum is 1 credit ($0.01)".to_string()));
    }

    let credits = req.amount_cents as i32; // 1 cent = 1 credit
    let raw_amount = (req.amount_cents as u64) * 10_000;

    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let api_key = api_key.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "No wallet found. Top up your balance at /balance first.".to_string())
    })?;

    // Check balance
    let balance_resp = outlayer_request(
        &state.http_client, &api_key, "GET",
        &format!("/wallet/v1/balance?token={}&source=intents", default_token()), None,
    ).await.map_err(|e| (StatusCode::BAD_GATEWAY, format!("Balance check failed: {}", e)))?;

    let balance: u64 = balance_resp["balance"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let raw_amount = adjust_for_dust(balance, raw_amount);
    if balance < raw_amount {
        return Err((StatusCode::BAD_REQUEST, format!("Insufficient balance. Need ${:.2}", req.amount_cents as f64 / 100.0)));
    }

    if state.config.treasury_agent_key.is_empty() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Credit purchases are not configured".to_string()));
    }

    // Pay treasury via check, then add credits. Detached.
    let st = state.clone();
    let buyer_id = claims.user_id;
    let flow = async move {
    let state = st;
    outlayer::pay_via_check(
        &state.http_client,
        &api_key,
        default_token(),
        &raw_amount.to_string(),
        &format!("Buy {} AI credits", credits),
        "buy-credits",
        &[outlayer::Leg {
            api_key: state.config.treasury_agent_key.clone(),
            amount: None,
            label: "treasury".to_string(),
        }],
        false,
    )
    .await
    .map_err(|(_, e)| (StatusCode::BAD_GATEWAY, format!("Payment failed: {}", e)))?;

    // Add credits
    let new_balance: i32 = sqlx::query_scalar(
        "UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2 RETURNING credit_balance"
    )
    .bind(credits)
    .bind(buyer_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(buyer_id, credits, "Credits paid but not added: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    tracing::info!(user_id = buyer_id, credits, "Credits purchased from balance");

    Ok(serde_json::json!({
        "credits_added": credits,
        "new_balance": new_balance,
    }))
    };

    finish(flow, "Payment is processing; credits will be added shortly.").await
}

// ── Premium from balance ──

#[derive(Deserialize)]
pub struct BuyPremiumRequest {
    pub months: u32,                    // 1, 2, 3, or 12
    pub recipient_slug: Option<String>, // gift to another user (None = self)
}

/// POST /api/premium/buy — buy premium subscription from OutLayer balance.
/// $10/month, max 12 months. Supports gifting to another user.
pub async fn buy_premium(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<BuyPremiumRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if req.months < 1 || req.months > 12 {
        return Err((StatusCode::BAD_REQUEST, "1-12 months allowed".to_string()));
    }

    let price_cents = req.months * 1000; // $10/month
    let days = (req.months * 30).min(365) as i32;
    let raw_amount = (price_cents as u64) * 10_000;

    // Resolve recipient
    let recipient_id = if let Some(ref slug) = req.recipient_slug {
        let rid: Option<i32> = sqlx::query_scalar("SELECT id FROM users WHERE slug = $1")
            .bind(slug).fetch_optional(&state.db).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        rid.ok_or_else(|| (StatusCode::NOT_FOUND, "Recipient not found".to_string()))?
    } else {
        claims.user_id
    };
    let is_gift = recipient_id != claims.user_id;

    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let api_key = api_key.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "No wallet found. Top up your balance first.".to_string())
    })?;

    // Check balance
    let balance_resp = outlayer_request(
        &state.http_client, &api_key, "GET",
        &format!("/wallet/v1/balance?token={}&source=intents", default_token()), None,
    ).await.map_err(|e| (StatusCode::BAD_GATEWAY, format!("Balance check failed: {}", e)))?;

    let balance: u64 = balance_resp["balance"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let raw_amount = adjust_for_dust(balance, raw_amount);
    if balance < raw_amount {
        return Err((StatusCode::BAD_REQUEST, format!("Insufficient balance. Need ${}.00", price_cents / 100)));
    }

    if state.config.treasury_agent_key.is_empty() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Premium purchases are not configured".to_string()));
    }

    // Pay treasury via check — must settle before granting premium. Detached.
    let st = state.clone();
    let buyer_id = claims.user_id;
    let buyer_sub = claims.sub.clone();
    let flow = async move {
    let state = st;
    outlayer::pay_via_check(
        &state.http_client,
        &api_key,
        default_token(),
        &raw_amount.to_string(),
        &format!("Premium {} months{}", req.months, if is_gift { " (gift)" } else { "" }),
        "buy-premium",
        &[outlayer::Leg {
            api_key: state.config.treasury_agent_key.clone(),
            amount: None,
            label: "treasury".to_string(),
        }],
        false,
    )
    .await
    .map_err(|(_, e)| (StatusCode::BAD_GATEWAY, format!("Payment failed: {}", e)))?;

    // Record purchase and add premium days atomically
    let purchase_ref = hex::encode(sha2::Sha256::digest(outlayer::fresh_idem_key().as_bytes()));
    sqlx::query(
        r#"WITH ins AS (
               INSERT INTO premium_purchases (user_id, check_key_hash, token, amount, days_added, gifted_by_user_id)
               VALUES ($1, $2, $3, $4, $5, $6)
           )
           UPDATE users SET
               premium_since = COALESCE(premium_since, NOW()),
               premium_until = GREATEST(COALESCE(premium_until, NOW()), NOW()) + make_interval(days => $5)
           WHERE id = $1"#,
    )
    .bind(recipient_id)
    .bind(&purchase_ref)
    .bind(default_token())
    .bind(raw_amount.to_string())
    .bind(days)
    .bind(if is_gift { Some(buyer_id) } else { None })
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(buyer_id, recipient_id, days, "Premium paid but not granted: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    // Notification for gift
    if is_gift {
        queries::create_notification(&state.db, recipient_id, "premium_gifted", &serde_json::json!({
            "from_account": buyer_sub,
            "months": req.months,
            "days_added": days,
        })).await.ok();
    }

    tracing::info!(
        user_id = buyer_id, recipient_id, months = req.months, days,
        is_gift, "Premium purchased from balance"
    );

    Ok(serde_json::json!({
        "status": "success",
        "months": req.months,
        "days_added": days,
        "price_cents": price_cents,
        "is_gift": is_gift,
    }))
    };

    finish(flow, "Payment is processing; premium will be activated shortly.").await
}

// ── Withdrawal ──

#[derive(Deserialize)]
pub struct WithdrawRequest {
    pub amount_cents: Option<u32>,
    pub amount_raw: Option<String>,  // exact raw USDC units (6 decimals) — takes precedence
    pub chain: String,               // "near", "solana", "ethereum"
    pub receiver: String,            // wallet address on destination chain
}

/// POST /api/wallet/withdraw — withdraw USDC to user's wallet on any chain.
/// Uses OutLayer gasless intents/withdraw.
pub async fn withdraw(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<WithdrawRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    if req.receiver.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Receiver address required".to_string()));
    }

    // Determine raw amount: amount_raw takes precedence over amount_cents
    let raw_amount: u64 = if let Some(ref raw) = req.amount_raw {
        raw.parse().map_err(|_| (StatusCode::BAD_REQUEST, "Invalid amount_raw".to_string()))?
    } else if let Some(cents) = req.amount_cents {
        (cents as u64) * 10_000
    } else {
        return Err((StatusCode::BAD_REQUEST, "amount_cents or amount_raw required".to_string()));
    };
    if raw_amount < 10_000 {
        return Err((StatusCode::BAD_REQUEST, "Minimum withdrawal is $0.01".to_string()));
    }

    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT outlayer_api_key FROM users WHERE id = $1"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let api_key = api_key.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "No wallet found".to_string())
    })?;

    // Check balance
    let balance_resp = outlayer_request(
        &state.http_client, &api_key, "GET",
        &format!("/wallet/v1/balance?token={}&source=intents", default_token()), None,
    ).await.map_err(|e| (StatusCode::BAD_GATEWAY, format!("Balance check failed: {}", e)))?;

    let balance: u64 = balance_resp["balance"].as_str().unwrap_or("0").parse().unwrap_or(0);
    let raw_amount = adjust_for_dust(balance, raw_amount);
    if balance < raw_amount {
        return Err((StatusCode::BAD_REQUEST, "Insufficient balance".to_string()));
    }

    // Gasless withdraw via OutLayer intents (use "to" not "receiver"). The API
    // runs it to its outcome even if we stop waiting; follow it briefly.
    let token_with_prefix = format!("nep141:{}", default_token());
    let body = serde_json::json!({
        "token": token_with_prefix,
        "amount": raw_amount.to_string(),
        "chain": req.chain,
        "to": req.receiver,
    });
    let idem = outlayer::fresh_idem_key();
    let outcome = outlayer::execute(&state.http_client, &api_key, "/wallet/v1/intents/withdraw", &body, &idem, 25)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Withdrawal failed: {}", e)))?;

    tracing::info!(
        user_id = claims.user_id,
        raw_amount = raw_amount,
        chain = %req.chain,
        receiver = %req.receiver,
        outcome = ?outcome,
        "USD withdrawal via OutLayer intents"
    );

    use axum::response::IntoResponse;
    match outcome {
        outlayer::Outcome::Final(details) => Ok(Json(serde_json::json!({
            "status": "success",
            "amount_raw": raw_amount.to_string(),
            "chain": req.chain,
            "receiver": req.receiver,
            "details": details,
        })).into_response()),
        outlayer::Outcome::Processing { body, .. } => Ok((StatusCode::ACCEPTED, Json(serde_json::json!({
            "status": "processing",
            "message": "Withdrawal is on its way. Do not resubmit — it will arrive shortly.",
            "request_id": body["request_id"],
            "amount_raw": raw_amount.to_string(),
            "chain": req.chain,
            "receiver": req.receiver,
        }))).into_response()),
        outlayer::Outcome::NeverExecuted { .. } => Err((StatusCode::BAD_GATEWAY,
            "Withdrawal was not executed — nothing moved. You can try again.".to_string())),
        outlayer::Outcome::Failed(why) => Err((StatusCode::BAD_GATEWAY, format!(
            "Withdrawal failed ({}). Funds may have partially moved — check your balance before retrying.", why))),
        outlayer::Outcome::NeedsReview(id) => Err((StatusCode::BAD_GATEWAY, format!(
            "Withdrawal outcome could not be confirmed (request {}). Do not retry — contact support.", id))),
    }
}

/// Register a new OutLayer wallet (no auth needed).
async fn register_outlayer_wallet(client: &reqwest::Client) -> Result<serde_json::Value, String> {
    let resp = client
        .post(format!("{}/register", outlayer::api_base()))
        .send()
        .await
        .map_err(|e| format!("Register request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Register failed: {}", resp.status()));
    }

    resp.json().await
        .map_err(|e| format!("Register parse failed: {}", e))
}

/// Helper: make authenticated request to OutLayer API
pub async fn outlayer_request(
    client: &reqwest::Client,
    api_key: &str,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", outlayer::api_base(), path);
    let mut req = match method {
        "POST" => client.post(&url),
        "GET" => client.get(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    req = req.header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json");

    if let Some(b) = body {
        req = req.json(&b);
    }

    let resp = req.send().await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("OutLayer {} {}: {} {}", method, path, status, text));
    }

    if text.is_empty() {
        return Ok(serde_json::json!({}));
    }

    serde_json::from_str(&text)
        .map_err(|e| format!("Parse error: {} (body: {})", e, &text[..100.min(text.len())]))
}

/// Adjust amount for dust: if balance is within 1 cent of required amount, use balance instead.
/// Prevents failures due to rounding (e.g. balance 9999998 vs required 10000000).
fn adjust_for_dust(balance: u64, amount: u64) -> u64 {
    if balance < amount && balance + 10_000 > amount { balance } else { amount }
}
