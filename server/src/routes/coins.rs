//! Song memecoins: an author launches a coin from their song on an external
//! launchpad (signed in their own NEAR wallet), then near.fm links it to the
//! song. Launchpad specifics live in `crate::launchpads`.

use axum::{
    extract::{Path, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{auth::jwt::require_auth, launchpads, AppState};

type ApiError = (StatusCode, String);

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SongCoin {
    pub launchpad: String,
    pub token_account: String,
    pub launch_id: Option<String>,
    pub creator_account: String,
    pub name: String,
    pub symbol: String,
    pub status: String,
    /// `launched` from this song, or `linked`: an existing coin the song is about.
    pub kind: String,
    pub icon: Option<String>,
    pub trade_url: Option<String>,
    pub trade_url_trusted: bool,
    pub relatedness: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

const COIN_COLUMNS: &str = "launchpad, token_account, launch_id, creator_account, name, symbol, status, kind, icon, trade_url, trade_url_trusted, relatedness, created_at";

#[derive(sqlx::FromRow)]
struct SongRow {
    id: i32,
    uploader_id: i32,
    title: String,
    description: Option<String>,
    lyrics: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn load_song(state: &AppState, uuid: &str) -> Result<SongRow, ApiError> {
    sqlx::query_as::<_, SongRow>(
        "SELECT id, uploader_id, title, description, lyrics, created_at FROM songs WHERE uuid = $1 AND NOT is_deleted",
    )
    .bind(uuid)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Song not found".to_string()))
}

/// The caller must be the song's author, signed in with a NEAR wallet.
/// Answers the author's NEAR account (the launch's creator).
async fn require_near_author(state: &AppState, user_id: i32, song: &SongRow) -> Result<String, ApiError> {
    if song.uploader_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Only the song's author can launch a coin from it".to_string()));
    }
    let row: Option<(String, Option<String>, bool)> =
        sqlx::query_as("SELECT auth_provider, account_id, is_banned FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match row {
        Some((_, _, true)) => Err((StatusCode::FORBIDDEN, "Account banned".to_string())),
        Some((provider, Some(account), false)) if provider == "near" => Ok(account),
        _ => Err((StatusCode::FORBIDDEN, "Coin launches need a NEAR wallet sign-in".to_string())),
    }
}

/// The caller must be the song's author (any sign-in) and not banned.
async fn require_author(state: &AppState, user_id: i32, song: &SongRow) -> Result<(), ApiError> {
    if song.uploader_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Only the song's author can do this".to_string()));
    }
    let banned: bool = sqlx::query_scalar("SELECT is_banned FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if banned {
        return Err((StatusCode::FORBIDDEN, "Account banned".to_string()));
    }
    Ok(())
}

async fn song_has_coin(state: &AppState, song_id: i32) -> Result<bool, ApiError> {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM song_coins WHERE song_id = $1 AND status <> 'hidden')")
        .bind(song_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn set_song_coin(state: &AppState, song_id: i32, coin: Option<&SongCoin>) {
    match coin {
        Some(c) => sqlx::query("UPDATE songs SET coin_symbol = $1, coin_launchpad = $2, coin_token_account = $3 WHERE id = $4")
            .bind(&c.symbol).bind(&c.launchpad).bind(&c.token_account).bind(song_id),
        None => sqlx::query("UPDATE songs SET coin_symbol = NULL, coin_launchpad = NULL, coin_token_account = NULL WHERE id = $1").bind(song_id),
    }
    .execute(&state.db)
    .await
    .ok();
}

#[derive(Deserialize)]
pub struct LookupQuery {
    pub token: String,
}

/// GET /api/coins/lookup?token=… — is this a token, what is it, where is it traded.
pub async fn lookup(
    State(state): State<AppState>,
    extensions: Extensions,
    axum::extract::Query(q): axum::extract::Query<LookupQuery>,
) -> Result<Json<launchpads::token::TokenInfo>, ApiError> {
    require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    let account = launchpads::token::extract_account_id(&q.token)
        .ok_or((StatusCode::BAD_REQUEST, "Enter the token's contract account (like coin.nearlytrade.near) or a link to it".to_string()))?;
    launchpads::token::lookup(&state.http_client, &state.config.near_rpc_url, &account)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttachRequest {
    pub token: String,
    pub trade_url: Option<String>,
}

/// POST /api/songs/:uuid/coins/attach — the song is about an existing coin.
/// The AI must find the song's words at least `COIN_MIN_RELATEDNESS` about it.
pub async fn attach(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
    Json(req): Json<AttachRequest>,
) -> Result<Json<SongCoin>, ApiError> {
    let claims = require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    let song = load_song(&state, &uuid).await?;
    require_author(&state, claims.user_id, &song).await?;
    if song_has_coin(&state, song.id).await? {
        return Err((StatusCode::CONFLICT, "This song already has a coin. Unlink it first.".to_string()));
    }
    let account = launchpads::token::extract_account_id(&req.token)
        .ok_or((StatusCode::BAD_REQUEST, "Enter the token's contract account or a link to it".to_string()))?;
    let info = launchpads::token::lookup(&state.http_client, &state.config.near_rpc_url, &account)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    // A trade link is required: ours when we are sure of it, else the author's.
    let (trade_url, trusted) = match req.trade_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => launchpads::token::check_trade_url(u).map_err(|e| (StatusCode::BAD_REQUEST, e))?,
        None => match &info.trade_url {
            Some(u) => (u.clone(), true),
            None => return Err((StatusCode::BAD_REQUEST, "We could not find where this token is traded — add a link to its trading page".to_string())),
        },
    };

    if !launchpads::ai_check::enabled() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "The relevance check is unavailable right now".to_string()));
    }
    launchpads::ai_check::take_quota(&state.db, claims.user_id, song.id, "coin_attach", &launchpads::ai_check::CHECK_QUOTA)
        .await
        .map_err(|e| (StatusCode::TOO_MANY_REQUESTS, e))?;
    let rel = launchpads::ai_check::relatedness(
        &state.http_client,
        &launchpads::ai_check::SongContext { title: &song.title, description: song.description.as_deref(), lyrics: song.lyrics.as_deref() },
        &launchpads::ai_check::CoinContext { name: &info.name, symbol: &info.symbol, description: None },
    )
    .await
    .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e))?;
    let min = launchpads::ai_check::min_relatedness();
    if rel.score < min {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("The song doesn't seem to be about ${} ({}/100 — needs at least {}): {}", info.symbol, rel.score, min, rel.reason),
        ));
    }

    let coin = sqlx::query_as::<_, SongCoin>(&format!(
        "INSERT INTO song_coins (song_id, launchpad, token_account, creator_account, name, symbol, status, kind, icon, trade_url, trade_url_trusted, linked_by_user_id, relatedness, ai_verdict) \
         VALUES ($1, $2, $3, $4, $5, $6, 'live', 'linked', $7, $8, $9, $10, $11, $12) RETURNING {COIN_COLUMNS}"
    ))
    .bind(song.id)
    .bind(&info.source)
    .bind(&info.token_account)
    .bind(info.creator.clone().unwrap_or_default())
    .bind(&info.name)
    .bind(&info.symbol)
    .bind(&info.icon)
    .bind(&trade_url)
    .bind(trusted)
    .bind(claims.user_id)
    .bind(rel.score as i32)
    .bind(serde_json::to_value(&rel).ok())
    .fetch_one(&state.db)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => (StatusCode::CONFLICT, "This song already has a coin".to_string()),
        e => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;
    set_song_coin(&state, song.id, Some(&coin)).await;
    tracing::info!(song_id = song.id, token = %coin.token_account, score = rel.score, trusted, "Song coin attached");
    Ok(Json(coin))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TradeUrlRequest {
    pub trade_url: String,
}

/// PATCH /api/songs/:uuid/coins/:token — the author changes where "Trade" points.
pub async fn set_trade_url(
    State(state): State<AppState>,
    extensions: Extensions,
    Path((uuid, token)): Path<(String, String)>,
    Json(req): Json<TradeUrlRequest>,
) -> Result<Json<SongCoin>, ApiError> {
    let claims = require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    let song = load_song(&state, &uuid).await?;
    require_author(&state, claims.user_id, &song).await?;
    let (url, trusted) = launchpads::token::check_trade_url(&req.trade_url).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    sqlx::query_as::<_, SongCoin>(&format!(
        "UPDATE song_coins SET trade_url = $1, trade_url_trusted = $2, updated_at = NOW() WHERE song_id = $3 AND token_account = $4 RETURNING {COIN_COLUMNS}"
    ))
    .bind(&url)
    .bind(trusted)
    .bind(song.id)
    .bind(&token)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map(Json)
    .ok_or((StatusCode::NOT_FOUND, "Coin not found".to_string()))
}

/// DELETE /api/songs/:uuid/coins/:token — unlink (author or admin). The
/// token itself is untouched; only the song page stops showing it.
pub async fn detach(
    State(state): State<AppState>,
    extensions: Extensions,
    Path((uuid, token)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let claims = require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    let song = load_song(&state, &uuid).await?;
    if !claims.is_admin {
        require_author(&state, claims.user_id, &song).await?;
    }
    let n = sqlx::query("DELETE FROM song_coins WHERE song_id = $1 AND token_account = $2")
        .bind(song.id)
        .bind(&token)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .rows_affected();
    if n == 0 {
        return Err((StatusCode::NOT_FOUND, "Coin not found".to_string()));
    }
    set_song_coin(&state, song.id, None).await;
    tracing::info!(song_id = song.id, token = %token, by = claims.user_id, "Song coin unlinked");
    Ok(StatusCode::NO_CONTENT)
}

/// Paid-inference gate for the author-facing AI routes: a funded wallet
/// (sybil cost) and per-user / per-song daily quotas.
async fn guard_ai(state: &AppState, user_id: i32, song_id: i32, creator: &str, kind: &str, quota: &launchpads::ai_check::Quota) -> Result<(), ApiError> {
    if !launchpads::ai_check::wallet_funded(&state.config.near_rpc_url, creator).await {
        return Err((StatusCode::PAYMENT_REQUIRED, "AI help needs at least 0.1 NEAR in your wallet (a launch costs about 0.2 NEAR)".to_string()));
    }
    launchpads::ai_check::take_quota(&state.db, user_id, song_id, kind, quota)
        .await
        .map_err(|e| (StatusCode::TOO_MANY_REQUESTS, e))
}

/// GET /api/songs/:uuid/coins — coins launched from this song (public).
/// Hidden ones (failed relevance check) are included with `status: hidden`
/// so the song page can tell the author rather than offer a second launch.
pub async fn list(State(state): State<AppState>, Path(uuid): Path<String>) -> Result<Json<Vec<SongCoin>>, ApiError> {
    let song = load_song(&state, &uuid).await?;
    let mut coins = sqlx::query_as::<_, SongCoin>(&format!(
        "SELECT {COIN_COLUMNS} FROM song_coins WHERE song_id = $1 ORDER BY created_at"
    ))
    .bind(song.id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // A launch finishes on chain a few blocks after it is linked: refresh pending ones.
    for coin in coins.iter_mut().filter(|c| c.status == "pending") {
        if let Ok(Some(l)) = launchpads::get_launch(&coin.launchpad, &state.config.near_rpc_url, &coin.token_account).await {
            if l.live {
                coin.status = "live".to_string();
                sqlx::query("UPDATE song_coins SET status = 'live', updated_at = NOW() WHERE launchpad = $1 AND token_account = $2 AND status = 'pending'")
                    .bind(&coin.launchpad)
                    .bind(&coin.token_account)
                    .execute(&state.db)
                    .await
                    .ok();
            }
        }
    }
    Ok(Json(coins))
}

/// Only the coin fields the launch itself carries; anything else (a prompt,
/// a model, instructions) is rejected at parse time.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckRequest {
    pub name: String,
    pub symbol: String,
    pub description: Option<String>,
}

/// The coin fields must already be valid launch inputs — the AI never sees
/// free-form text beyond what the launchpad would store.
fn validate_coin_fields(req: &CheckRequest) -> Result<(String, String, Option<String>), ApiError> {
    let bad = |m: &str| (StatusCode::BAD_REQUEST, m.to_string());
    let name = launchpads::ai_check::clean(&req.name, 32);
    if name.chars().count() < 2 {
        return Err(bad("name: 2 to 32 characters"));
    }
    let symbol = req.symbol.trim().to_uppercase();
    if !(2..=12).contains(&symbol.len()) || !symbol.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(bad("symbol: 2 to 12 letters or digits"));
    }
    let description = req
        .description
        .as_deref()
        .map(|d| launchpads::ai_check::clean(d, 300))
        .filter(|d| !d.is_empty());
    Ok((name, symbol, description))
}

#[derive(Serialize)]
pub struct CheckResponse {
    pub ai_enabled: bool,
    #[serde(flatten)]
    pub verdict: launchpads::ai_check::Verdict,
}

/// POST /api/songs/:uuid/coins/check — optional AI review before launching.
pub async fn check(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
    Json(req): Json<CheckRequest>,
) -> Result<Json<CheckResponse>, ApiError> {
    let claims = require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    let (name, symbol, description) = validate_coin_fields(&req)?;
    let song = load_song(&state, &uuid).await?;
    let creator = require_near_author(&state, claims.user_id, &song).await?;
    if launchpads::ai_check::enabled() {
        guard_ai(&state, claims.user_id, song.id, &creator, "coin_check", &launchpads::ai_check::CHECK_QUOTA).await?;
    }

    let verdict = launchpads::ai_check::review(
        &state.http_client,
        &launchpads::ai_check::SongContext {
            title: &song.title,
            description: song.description.as_deref(),
            lyrics: song.lyrics.as_deref(),
        },
        &launchpads::ai_check::CoinContext {
            name: &name,
            symbol: &symbol,
            description: description.as_deref(),
        },
    )
    .await;

    if verdict.reviewed {
        sqlx::query("INSERT INTO song_coin_checks (song_id, name, symbol, allowed, reason) VALUES ($1, $2, $3, $4, $5)")
            .bind(song.id)
            .bind(&name)
            .bind(&symbol)
            .bind(verdict.allowed)
            .bind(&verdict.reason)
            .execute(&state.db)
            .await
            .ok();
    }
    Ok(Json(CheckResponse { ai_enabled: launchpads::ai_check::enabled(), verdict }))
}

/// POST /api/songs/:uuid/coins/suggest — AI proposes name, ticker and description.
pub async fn suggest(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
) -> Result<Json<launchpads::ai_check::Suggestion>, ApiError> {
    let claims = require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    let song = load_song(&state, &uuid).await?;
    let creator = require_near_author(&state, claims.user_id, &song).await?;
    if !launchpads::ai_check::enabled() {
        return Err((StatusCode::SERVICE_UNAVAILABLE, "AI suggestions are not enabled".to_string()));
    }
    guard_ai(&state, claims.user_id, song.id, &creator, "coin_suggest", &launchpads::ai_check::SUGGEST_QUOTA).await?;
    let s = launchpads::ai_check::suggest(
        &state.http_client,
        &launchpads::ai_check::SongContext {
            title: &song.title,
            description: song.description.as_deref(),
            lyrics: song.lyrics.as_deref(),
        },
    )
    .await
    .map_err(|e| (if e.contains("busy") || e.contains("budget") { StatusCode::TOO_MANY_REQUESTS } else { StatusCode::BAD_GATEWAY }, e))?;
    Ok(Json(s))
}

/// Launches are gated by `COIN_LAUNCH_ENABLED=1` while the flow is being verified.
fn launch_enabled() -> bool {
    matches!(std::env::var("COIN_LAUNCH_ENABLED").as_deref(), Ok("1") | Ok("true"))
}

#[derive(Deserialize)]
pub struct DryRunRequest {
    pub launchpad: String,
    pub transactions: serde_json::Value,
    pub quote: Option<serde_json::Value>,
}

/// POST /api/songs/:uuid/coins/dry-run — the exact transactions the wallet is
/// about to sign, logged for review. Answers whether launching is enabled.
pub async fn dry_run(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
    Json(req): Json<DryRunRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let claims = require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    let song = load_song(&state, &uuid).await?;
    let creator = require_near_author(&state, claims.user_id, &song).await?;

    // Log with the icon shortened to its length; the rest verbatim.
    let mut logged = req.transactions.clone();
    if let Some(arr) = logged.as_array_mut() {
        for tx in arr.iter_mut() {
            if let Some(icon) = tx.pointer_mut("/args/args/icon") {
                if let Some(s) = icon.as_str() {
                    let head: String = s.chars().take(40).collect();
                    *icon = serde_json::Value::String(format!("{head}… ({} bytes)", s.len()));
                }
            }
        }
    }
    tracing::info!(
        song_id = song.id,
        song_uuid = %uuid,
        creator = %creator,
        launchpad = %req.launchpad,
        launch_enabled = launch_enabled(),
        quote = %req.quote.clone().unwrap_or(serde_json::Value::Null),
        transactions = %logged,
        "Coin launch dry-run"
    );
    Ok(Json(serde_json::json!({ "launch_enabled": launch_enabled() })))
}

#[derive(Deserialize)]
pub struct LinkRequest {
    pub launchpad: String,
    pub symbol: String,
}

/// POST /api/songs/:uuid/coins/link — find the author's launch on chain and
/// link it to the song. 404 while the launch is not on chain yet (retry).
pub async fn link(
    State(state): State<AppState>,
    extensions: Extensions,
    Path(uuid): Path<String>,
    Json(req): Json<LinkRequest>,
) -> Result<Json<SongCoin>, ApiError> {
    let claims = require_auth(&extensions).map_err(|s| (s, "Authentication required".to_string()))?;
    if !launchpads::is_supported(&req.launchpad) {
        return Err((StatusCode::BAD_REQUEST, "Unsupported launchpad".to_string()));
    }
    let song = load_song(&state, &uuid).await?;
    let creator = require_near_author(&state, claims.user_id, &song).await?;

    // Only a coin launched after the song existed can be "from" the song.
    let since_ms = (song.created_at.timestamp_millis().max(0)) as u64;
    let found = launchpads::find_launch(&req.launchpad, &state.config.near_rpc_url, &creator, req.symbol.trim(), since_ms)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Launchpad read failed: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "Launch not found on chain yet".to_string()))?;

    // Relevance: reuse the author's pre-launch check for this name/ticker, else review now.
    let prior: Option<(bool, Option<String>)> = sqlx::query_as(
        "SELECT allowed, reason FROM song_coin_checks WHERE song_id = $1 AND symbol = $2 AND name = $3 \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(song.id)
    .bind(found.symbol.to_uppercase())
    .bind(&found.name)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let verdict = match prior {
        Some((allowed, reason)) => launchpads::ai_check::Verdict { allowed, reason: reason.unwrap_or_default(), reviewed: true },
        None => {
            launchpads::ai_check::review(
                &state.http_client,
                &launchpads::ai_check::SongContext {
                    title: &song.title,
                    description: song.description.as_deref(),
                    lyrics: song.lyrics.as_deref(),
                },
                &launchpads::ai_check::CoinContext {
                    name: &found.name,
                    symbol: &found.symbol,
                    description: found.description.as_deref(),
                },
            )
            .await
        }
    };
    let status = if !verdict.allowed {
        "hidden"
    } else if found.live {
        "live"
    } else {
        "pending"
    };

    let inserted = sqlx::query_as::<_, SongCoin>(&format!(
        "INSERT INTO song_coins (song_id, launchpad, token_account, launch_id, creator_account, name, symbol, status, ai_verdict, kind, trade_url) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'launched', $10) \
         RETURNING {COIN_COLUMNS}"
    ))
    .bind(song.id)
    .bind(&req.launchpad)
    .bind(&found.token_account)
    .bind(&found.launch_id)
    .bind(&found.creator)
    .bind(&found.name)
    .bind(&found.symbol)
    .bind(status)
    .bind(serde_json::to_value(&verdict).ok())
    .bind(launchpads::getter_trade_url(&req.launchpad, &found.token_account))
    .fetch_one(&state.db)
    .await;

    let coin = match inserted {
        Ok(c) => c,
        Err(sqlx::Error::Database(db)) if db.constraint() == Some("song_coins_song_id_launchpad_key") => {
            return Err((StatusCode::CONFLICT, "This song already has a coin on this launchpad".to_string()));
        }
        Err(sqlx::Error::Database(db)) if db.constraint() == Some("song_coins_launchpad_token_account_key") => {
            return Err((StatusCode::CONFLICT, "This coin is already linked to a song".to_string()));
        }
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    if coin.status != "hidden" {
        set_song_coin(&state, song.id, Some(&coin)).await;
    }

    tracing::info!(song_id = song.id, launchpad = %coin.launchpad, token = %coin.token_account, status = %coin.status, "Song coin linked");

    if coin.status == "hidden" {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("The coin launched, but it doesn't look related to this song, so it won't be shown here: {}", verdict.reason),
        ));
    }
    Ok(Json(coin))
}
