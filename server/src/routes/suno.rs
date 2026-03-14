use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use axum::{
    extract::{Query, State},
    http::{Extensions, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::auth::jwt;
use crate::AppState;

const MAX_PROMPT_LEN: usize = 2000;
const MAX_LYRICS_LEN: usize = 10_000;
const MAX_STYLE_LEN: usize = 500;
const MAX_TITLE_LEN: usize = 200;
const CACHE_TTL_SECS: u64 = 30 * 60; // 30 minutes

// ── In-memory task cache (populated by callback) ──

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SunoTaskData {
    pub status: String,
    pub suno_data: Option<Vec<SunoSongData>>,
    #[serde(skip)]
    pub created_at: Option<Instant>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SunoSongData {
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub id: Option<String>,
    // Accept both snake_case (callback) and camelCase (polling)
    #[serde(alias = "audioUrl", alias = "audio_url")]
    pub audio_url: Option<String>,
    #[serde(alias = "streamAudioUrl", alias = "stream_audio_url")]
    pub stream_audio_url: Option<String>,
    #[serde(alias = "imageUrl", alias = "image_url")]
    pub image_url: Option<String>,
    #[serde(alias = "sourceImageUrl", alias = "source_image_url")]
    pub source_image_url: Option<String>,
    #[serde(alias = "sourceAudioUrl", alias = "source_audio_url")]
    pub source_audio_url: Option<String>,
    pub title: Option<String>,
    pub tags: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_f64")]
    pub duration: Option<f64>,
    pub prompt: Option<String>,
    #[serde(default, alias = "createTime", alias = "create_time", deserialize_with = "deserialize_optional_string")]
    pub create_time: Option<String>,
}

fn deserialize_optional_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let val = serde_json::Value::deserialize(deserializer)?;
    match val {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Number(n) => Ok(n.as_f64()),
        serde_json::Value::String(s) => Ok(s.parse::<f64>().ok()),
        _ => Ok(None),
    }
}

fn deserialize_optional_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let val = serde_json::Value::deserialize(deserializer)?;
    match val {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(s) => Ok(Some(s)),
        serde_json::Value::Number(n) => Ok(Some(n.to_string())),
        other => Ok(Some(other.to_string())),
    }
}

pub type SunoTaskCache = Arc<RwLock<HashMap<String, SunoTaskData>>>;

pub fn new_task_cache() -> SunoTaskCache {
    Arc::new(RwLock::new(HashMap::new()))
}

// ── Request/Response types ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub prompt: Option<String>,
    pub style: Option<String>,
    pub title: Option<String>,
    pub lyrics: Option<String>,
    pub model: Option<String>,
    pub instrumental: Option<bool>,
    pub custom_mode: Option<bool>,
}

#[derive(Serialize)]
pub struct GenerateResponse {
    pub task_id: String,
}

#[derive(Deserialize)]
pub struct StatusQuery {
    #[serde(rename = "taskId")]
    pub task_id: String,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub status: String,
    pub songs: Vec<SongVariant>,
}

#[derive(Serialize)]
pub struct SongVariant {
    pub id: String,
    pub audio_url: Option<String>,
    pub stream_audio_url: Option<String>,
    pub image_url: Option<String>,
    pub title: String,
    pub tags: String,
    pub duration: Option<f64>,
    pub lyrics: String,
}

#[derive(Deserialize)]
pub struct DownloadQuery {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "songIndex")]
    pub song_index: usize,
    /// "audio" or "image"
    #[serde(default = "default_download_type")]
    pub r#type: String,
}

fn default_download_type() -> String {
    "audio".to_string()
}

#[derive(Serialize)]
pub struct CreditsResponse {
    pub credits: i64,
}

// ── Lyrics types ──

#[derive(Deserialize)]
pub struct GenerateLyricsRequest {
    pub prompt: String,
}

#[derive(Serialize)]
pub struct GenerateLyricsResponse {
    pub task_id: String,
}

#[derive(Deserialize)]
pub struct LyricsStatusQuery {
    #[serde(rename = "taskId")]
    pub task_id: String,
}

#[derive(Serialize)]
pub struct LyricsStatusResponse {
    pub status: String,
    pub title: Option<String>,
    pub text: Option<String>,
}

// ── Callback payload ──

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SunoCallbackPayload {
    pub task_id: Option<String>,
    pub status: Option<String>,
    pub suno_data: Option<Vec<SunoSongData>>,
    // lyrics callback fields
    pub data: Option<SunoLyricsCallbackData>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SunoLyricsCallbackData {
    pub title: Option<String>,
    pub text: Option<String>,
    pub status: Option<String>,
}

// ── Helpers ──

fn require_api_key(config: &crate::config::Config) -> Result<&str, (StatusCode, String)> {
    let key = &config.suno_api_key;
    if key.is_empty() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Suno API key not configured".to_string(),
        ));
    }
    Ok(key.as_str())
}

const CREDITS_PER_SONG: i32 = 12;
const CREDITS_PER_LYRICS: i32 = 1;
pub const DAILY_PREMIUM_ALLOWANCE: i32 = 40;

#[derive(Debug, Clone)]
struct DeductionResult {
    from_daily: i32,
    from_purchased: i32,
}

/// Atomically deduct credits. Admins: free. Premium: daily first, then purchased. Others: purchased only.
async fn deduct_credits(
    db: &sqlx::PgPool,
    user_id: i32,
    cost: i32,
) -> Result<Option<DeductionResult>, (StatusCode, String)> {
    // Single atomic query: compute daily vs purchased split, deduct, return result.
    // FOR UPDATE locks the row to prevent concurrent races.
    let row: Option<(i32, i32, i32)> = sqlx::query_as(
        r#"
        WITH state AS (
            SELECT id, credit_balance, is_admin,
                premium_until IS NOT NULL AND premium_until > NOW() as is_premium,
                CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END as used_today
            FROM users WHERE id = $1 FOR UPDATE
        ),
        calc AS (
            SELECT
                CASE WHEN is_admin THEN 0
                     WHEN is_premium THEN LEAST($2, GREATEST(0, $3 - used_today))
                     ELSE 0 END as from_daily,
                CASE WHEN is_admin THEN 0
                     WHEN is_premium THEN GREATEST(0, $2 - LEAST($2, GREATEST(0, $3 - used_today)))
                     ELSE $2 END as from_purchased,
                is_admin
            FROM state
        )
        UPDATE users SET
            daily_credits_date = CURRENT_DATE,
            daily_credits_used = CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END
                + (SELECT from_daily FROM calc),
            credit_balance = credit_balance - (SELECT from_purchased FROM calc)
        FROM calc
        WHERE users.id = $1
            AND (calc.is_admin OR credit_balance >= calc.from_purchased)
        RETURNING
            credit_balance,
            (SELECT from_daily FROM calc),
            (SELECT from_purchased FROM calc)
        "#,
    )
    .bind(user_id)
    .bind(cost)
    .bind(DAILY_PREMIUM_ALLOWANCE)
    .fetch_optional(db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match row {
        Some((_, from_daily, from_purchased)) => {
            if from_daily == 0 && from_purchased == 0 {
                // Admin — no deduction
                Ok(None)
            } else {
                Ok(Some(DeductionResult { from_daily, from_purchased }))
            }
        }
        None => Err((
            StatusCode::PAYMENT_REQUIRED,
            format!("Insufficient credits ({} required). Top up at /credits", cost),
        )),
    }
}

/// Refund credits after a failed API call. Reverses daily and purchased amounts.
async fn refund_credits(
    db: &sqlx::PgPool,
    user_id: i32,
    deduction: &DeductionResult,
    action: &str,
    reference_id: &str,
) {
    let total = deduction.from_daily + deduction.from_purchased;

    let refund_result = sqlx::query(
        r#"
        UPDATE users SET
            credit_balance = credit_balance + $2,
            daily_credits_used = GREATEST(0,
                CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END - $3)
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .bind(deduction.from_purchased)
    .bind(deduction.from_daily)
    .execute(db)
    .await;

    if let Err(e) = refund_result {
        tracing::error!(user_id, error = %e, "Failed to refund credits");
    }

    // Audit trail for refund (negative credits_spent)
    sqlx::query(
        "INSERT INTO credit_usage (user_id, credits_spent, from_daily, from_purchased, action, reference_id) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(user_id)
    .bind(-total)
    .bind(-deduction.from_daily)
    .bind(-deduction.from_purchased)
    .bind(action)
    .bind(reference_id)
    .execute(db)
    .await
    .ok();

    tracing::warn!(user_id, from_daily = deduction.from_daily, from_purchased = deduction.from_purchased,
        "Refunded {} credits after failure", total);
}

/// Insert credit usage audit row.
async fn log_credit_usage(
    db: &sqlx::PgPool,
    user_id: i32,
    deduction: &DeductionResult,
    action: &str,
    reference_id: &str,
) {
    let total = deduction.from_daily + deduction.from_purchased;
    let result = sqlx::query(
        "INSERT INTO credit_usage (user_id, credits_spent, from_daily, from_purchased, action, reference_id) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(user_id)
    .bind(total)
    .bind(deduction.from_daily)
    .bind(deduction.from_purchased)
    .bind(action)
    .bind(reference_id)
    .execute(db)
    .await;
    if let Err(e) = result {
        tracing::error!(user_id, error = %e, "Failed to log credit usage");
    }
}

fn prune_cache(cache: &mut HashMap<String, SunoTaskData>, max: usize) {
    if cache.len() <= max {
        return;
    }
    let now = Instant::now();
    let stale_keys: Vec<String> = cache
        .iter()
        .filter(|(_, v)| {
            v.created_at
                .map(|t| now.duration_since(t).as_secs() > CACHE_TTL_SECS)
                .unwrap_or(true)
        })
        .map(|(k, _)| k.clone())
        .collect();
    for key in stale_keys {
        cache.remove(&key);
    }
    // If still over max, remove oldest
    while cache.len() > max {
        if let Some(key) = cache.keys().next().cloned() {
            cache.remove(&key);
        } else {
            break;
        }
    }
}

fn parse_suno_songs(data: Option<&[SunoSongData]>) -> Vec<SongVariant> {
    data.map(|songs| {
        songs
            .iter()
            .map(|s| SongVariant {
                id: s.id.clone().unwrap_or_default(),
                audio_url: s.audio_url.clone(),
                stream_audio_url: s.stream_audio_url.clone(),
                image_url: s.image_url.clone(),
                title: s.title.clone().unwrap_or_default(),
                tags: s.tags.clone().unwrap_or_default(),
                duration: s.duration,
                lyrics: s.prompt.clone().unwrap_or_default(),
            })
            .collect()
    })
    .unwrap_or_default()
}

// ── Handlers ──

/// POST /api/suno/generate — proxy music generation to Suno API
pub async fn generate(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, (StatusCode, String)> {
    let claims = jwt::require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let api_key = require_api_key(&state.config)?;

    // Input validation (before deducting credits)
    if let Some(ref p) = req.prompt {
        if p.len() > MAX_PROMPT_LEN {
            return Err((StatusCode::BAD_REQUEST, "Prompt too long".to_string()));
        }
    }
    if let Some(ref l) = req.lyrics {
        if l.len() > MAX_LYRICS_LEN {
            return Err((StatusCode::BAD_REQUEST, "Lyrics too long".to_string()));
        }
    }
    if let Some(ref s) = req.style {
        if s.len() > MAX_STYLE_LEN {
            return Err((StatusCode::BAD_REQUEST, "Style too long".to_string()));
        }
    }
    if let Some(ref t) = req.title {
        if t.len() > MAX_TITLE_LEN {
            return Err((StatusCode::BAD_REQUEST, "Title too long".to_string()));
        }
    }

    // Deduct credits (admins free, premium uses daily allowance first)
    let deduction = deduct_credits(&state.db, claims.user_id, CREDITS_PER_SONG).await?;

    let custom_mode = req.custom_mode.unwrap_or(false);
    let model = req.model.clone().unwrap_or_else(|| "V4_5".to_string());

    let suno_body = if custom_mode {
        serde_json::json!({
            "customMode": true,
            "instrumental": req.instrumental.unwrap_or(false),
            "model": model,
            "prompt": req.lyrics.clone().unwrap_or_default(),
            "style": req.style.clone().unwrap_or_default(),
            "title": req.title.clone().unwrap_or_default(),
            "callBackUrl": "https://api.near.fm/api/suno/callback"
        })
    } else {
        serde_json::json!({
            "customMode": false,
            "instrumental": req.instrumental.unwrap_or(false),
            "model": model,
            "prompt": req.prompt.clone().unwrap_or_default(),
            "callBackUrl": "https://api.near.fm/api/suno/callback"
        })
    };

    tracing::info!(
        "Suno generate request from user {} (custom={})",
        claims.sub,
        custom_mode
    );

    let resp = state
        .suno_client
        .post("https://api.sunoapi.org/api/v1/generate")
        .bearer_auth(api_key)
        .json(&suno_body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Suno API request failed: {:?}", e);
            if let Some(ref d) = deduction {
                let db = state.db.clone();
                let d = d.clone();
                let uid = claims.user_id;
                tokio::spawn(async move {
                    refund_credits(&db, uid, &d, "refund_song_generation", "suno_request_error").await;
                });
            }
            (StatusCode::BAD_GATEWAY, format!("Suno API error: {}", e))
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("Suno API returned {}: {}", status, body);
        if let Some(ref d) = deduction {
            refund_credits(&state.db, claims.user_id, d, "refund_song_generation", &format!("suno_http_{}", status.as_u16())).await;
        }
        return Err((StatusCode::BAD_GATEWAY, format!("Suno API error: {}", body)));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| {
            if let Some(ref d) = deduction {
                let db = state.db.clone();
                let d = d.clone();
                let uid = claims.user_id;
                tokio::spawn(async move {
                    refund_credits(&db, uid, &d, "refund_song_generation", "suno_json_parse_error").await;
                });
            }
            (StatusCode::BAD_GATEWAY, format!("Invalid Suno response: {}", e))
        })?;

    let task_id = body["data"]["taskId"]
        .as_str()
        .or_else(|| body["taskId"].as_str())
        .unwrap_or_default()
        .to_string();

    if task_id.is_empty() {
        let suno_msg = body["msg"].as_str().unwrap_or("").to_string();
        tracing::error!("No taskId in Suno response: {:?}", body);
        if let Some(ref d) = deduction {
            refund_credits(&state.db, claims.user_id, d, "refund_song_generation", "suno_no_task_id").await;
        }
        let user_msg = if !suno_msg.is_empty() {
            suno_msg
        } else {
            "No task ID returned from Suno API".to_string()
        };
        return Err((
            StatusCode::BAD_GATEWAY,
            user_msg,
        ));
    }

    // Log credit usage with task_id reference
    if let Some(ref d) = deduction {
        log_credit_usage(&state.db, claims.user_id, d, "song_generation", &task_id).await;
    }

    // Register task in cache so callback can only update known tasks
    {
        let mut cache = state.suno_cache.write().await;
        cache.insert(
            task_id.clone(),
            SunoTaskData {
                status: "PENDING".to_string(),
                suno_data: None,
                created_at: Some(Instant::now()),
            },
        );
        prune_cache(&mut cache, 500);
    }

    Ok(Json(GenerateResponse { task_id }))
}

/// GET /api/suno/status?taskId=... — check generation status
pub async fn status(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(params): Query<StatusQuery>,
) -> Result<Json<StatusResponse>, (StatusCode, String)> {
    jwt::require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // First check in-memory cache (populated by callback)
    {
        let cache = state.suno_cache.read().await;
        if let Some(task_data) = cache.get(&params.task_id) {
            let songs = parse_suno_songs(task_data.suno_data.as_deref());
            tracing::debug!(
                "Suno status: task={} status={} cached_songs={} parsed_songs={}",
                params.task_id,
                task_data.status,
                task_data.suno_data.as_ref().map(|v| v.len()).unwrap_or(0),
                songs.len()
            );
            return Ok(Json(StatusResponse {
                status: task_data.status.clone(),
                songs,
            }));
        }
    }

    // Fallback: poll Suno API directly
    let api_key = require_api_key(&state.config)?;

    let resp = state
        .http_client
        .get("https://api.sunoapi.org/api/v1/generate/record-info")
        .bearer_auth(api_key)
        .query(&[("taskId", &params.task_id)])
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Suno API error: {}", e)))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_GATEWAY, format!("Suno API error: {}", body)));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Invalid Suno response: {}", e)))?;

    let status_str = body["data"]["status"]
        .as_str()
        .unwrap_or("PENDING")
        .to_string();

    let suno_data: Option<Vec<SunoSongData>> = body["data"]["sunoData"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect()
        });

    let songs = parse_suno_songs(suno_data.as_deref());

    Ok(Json(StatusResponse {
        status: status_str,
        songs,
    }))
}

/// GET /api/suno/credits — check remaining credits (admin only)
pub async fn credits(
    State(state): State<AppState>,
    extensions: Extensions,
) -> Result<Json<CreditsResponse>, (StatusCode, String)> {
    jwt::require_admin(&extensions)
        .map_err(|s| (s, "Admin access required".to_string()))?;

    let api_key = require_api_key(&state.config)?;

    let resp = state
        .http_client
        .get("https://api.sunoapi.org/api/v1/generate/credit")
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Suno API error: {}", e)))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Invalid response: {}", e)))?;

    let credits = body["data"].as_i64().unwrap_or(0);

    Ok(Json(CreditsResponse { credits }))
}

/// POST /api/suno/callback — webhook callback from Suno API
pub async fn callback(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("Suno callback raw payload: {}", payload);

    // Callback structure: { "code": 200, "data": { "callbackType": "complete", "task_id": "...", "data": [...] } }
    let data = &payload["data"];

    let task_id = data["task_id"]
        .as_str()
        .or_else(|| data["taskId"].as_str())
        .or_else(|| payload["task_id"].as_str())
        .or_else(|| payload["taskId"].as_str())
        .unwrap_or("")
        .to_string();

    if task_id.is_empty() {
        tracing::warn!("Suno callback without task_id");
        return Ok(StatusCode::OK);
    }

    // Check if Suno returned an error (code != 200)
    let suno_code = payload["code"].as_i64().unwrap_or(200);
    let error_msg = payload["msg"].as_str().unwrap_or("");

    let status_str = if suno_code != 200 {
        tracing::warn!("Suno callback error: code={} msg={}", suno_code, error_msg);
        format!("ERROR: {}", if error_msg.is_empty() { "Generation failed" } else { error_msg })
    } else {
        // callbackType: "text" | "first" | "complete"
        let callback_type = data["callbackType"]
            .as_str()
            .unwrap_or("unknown");

        match callback_type {
            "complete" => "SUCCESS".to_string(),
            "first" => "FIRST_SUCCESS".to_string(),
            "text" => "TEXT_SUCCESS".to_string(),
            other => other.to_uppercase(),
        }
    };

    // Song data is in data.data (array of song objects)
    let suno_data: Option<Vec<SunoSongData>> = data["data"]
        .as_array()
        .or_else(|| payload["sunoData"].as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    serde_json::from_value::<SunoSongData>(v.clone()).map_err(|e| {
                        tracing::warn!("Failed to parse SunoSongData: {} — raw: {}", e, v);
                        e
                    }).ok()
                })
                .collect::<Vec<_>>()
        })
        .filter(|v| !v.is_empty());

    // Only accept callbacks for tasks we initiated
    let mut cache = state.suno_cache.write().await;
    if !cache.contains_key(&task_id) {
        tracing::warn!("Suno callback for unknown task_id: {}", task_id);
        return Ok(StatusCode::OK);
    }

    tracing::info!(
        "Suno callback: task={} status={} songs_count={}",
        task_id,
        status_str,
        suno_data.as_ref().map(|v| v.len()).unwrap_or(0)
    );

    cache.insert(
        task_id,
        SunoTaskData {
            status: status_str,
            suno_data,
            created_at: Some(Instant::now()),
        },
    );
    prune_cache(&mut cache, 500);

    Ok(StatusCode::OK)
}

/// POST /api/suno/generate-lyrics — generate lyrics via Suno
pub async fn generate_lyrics(
    State(state): State<AppState>,
    extensions: Extensions,
    Json(req): Json<GenerateLyricsRequest>,
) -> Result<Json<GenerateLyricsResponse>, (StatusCode, String)> {
    let claims = jwt::require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    let api_key = require_api_key(&state.config)?;

    if req.prompt.len() > MAX_PROMPT_LEN {
        return Err((StatusCode::BAD_REQUEST, "Prompt too long".to_string()));
    }

    let deduction = deduct_credits(&state.db, claims.user_id, CREDITS_PER_LYRICS).await?;

    let resp = state
        .suno_client
        .post("https://api.sunoapi.org/api/v1/lyrics")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "prompt": req.prompt,
            "callBackUrl": "https://api.near.fm/api/suno/lyrics-callback"
        }))
        .send()
        .await
        .map_err(|e| {
            if let Some(ref d) = deduction {
                let db = state.db.clone();
                let d = d.clone();
                let uid = claims.user_id;
                tokio::spawn(async move {
                    refund_credits(&db, uid, &d, "refund_lyrics_generation", "suno_request_error").await;
                });
            }
            (StatusCode::BAD_GATEWAY, format!("Suno API error: {}", e))
        })?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        if let Some(ref d) = deduction {
            refund_credits(&state.db, claims.user_id, d, "refund_lyrics_generation", "suno_lyrics_error").await;
        }
        return Err((StatusCode::BAD_GATEWAY, format!("Suno API error: {}", body)));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| {
        if let Some(ref d) = deduction {
            let db = state.db.clone();
            let d = d.clone();
            let uid = claims.user_id;
            tokio::spawn(async move {
                refund_credits(&db, uid, &d, "refund_lyrics_generation", "suno_json_parse_error").await;
            });
        }
        (StatusCode::BAD_GATEWAY, format!("Invalid Suno response: {}", e))
    })?;

    let task_id = body["data"]["taskId"]
        .as_str()
        .or_else(|| body["taskId"].as_str())
        .unwrap_or_default()
        .to_string();

    if let Some(ref d) = deduction {
        log_credit_usage(&state.db, claims.user_id, d, "lyrics_generation", &task_id).await;
    }

    // Register in lyrics cache so callback is validated
    {
        let mut cache = state.suno_lyrics_cache.write().await;
        cache.insert(
            task_id.clone(),
            SunoLyricsCallbackData {
                title: None,
                text: None,
                status: Some("PENDING".to_string()),
            },
        );
    }

    Ok(Json(GenerateLyricsResponse { task_id }))
}

/// GET /api/suno/lyrics-status?taskId=... — poll lyrics generation
pub async fn lyrics_status(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(params): Query<LyricsStatusQuery>,
) -> Result<Json<LyricsStatusResponse>, (StatusCode, String)> {
    jwt::require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Check in-memory cache first
    {
        let cache = state.suno_lyrics_cache.read().await;
        if let Some(data) = cache.get(&params.task_id) {
            let status = data.status.clone().unwrap_or_else(|| "PENDING".to_string());
            // Only return from cache if completed (has text)
            if data.text.is_some() {
                return Ok(Json(LyricsStatusResponse {
                    status: "SUCCESS".to_string(),
                    title: data.title.clone(),
                    text: data.text.clone(),
                }));
            }
            // If PENDING in cache, fall through to poll Suno
            if status == "PENDING" {
                // fall through
            } else {
                return Ok(Json(LyricsStatusResponse {
                    status,
                    title: data.title.clone(),
                    text: data.text.clone(),
                }));
            }
        }
    }

    // Fallback: poll Suno API
    let api_key = require_api_key(&state.config)?;

    let resp = state
        .http_client
        .get("https://api.sunoapi.org/api/v1/lyrics/record-info")
        .bearer_auth(api_key)
        .query(&[("taskId", &params.task_id)])
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Suno API error: {}", e)))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Invalid response: {}", e)))?;

    let status = body["data"]["status"]
        .as_str()
        .unwrap_or("PENDING")
        .to_string();
    let title = body["data"]["title"].as_str().map(|s| s.to_string());
    let text = body["data"]["text"].as_str().map(|s| s.to_string());

    Ok(Json(LyricsStatusResponse { status, title, text }))
}

/// GET /api/suno/download?taskId=...&songIndex=0&type=audio — download audio/image from cached task
pub async fn download(
    State(state): State<AppState>,
    extensions: Extensions,
    Query(params): Query<DownloadQuery>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    use axum::response::IntoResponse;

    jwt::require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Look up the URLs from cached task data
    let urls = {
        let cache = state.suno_cache.read().await;
        let task = cache.get(&params.task_id).ok_or_else(|| {
            (StatusCode::NOT_FOUND, "Task not found".to_string())
        })?;
        let songs = task.suno_data.as_ref().ok_or_else(|| {
            (StatusCode::NOT_FOUND, "No songs in task".to_string())
        })?;
        let song = songs.get(params.song_index).ok_or_else(|| {
            (StatusCode::NOT_FOUND, "Song index out of range".to_string())
        })?;

        let urls: Vec<String> = match params.r#type.as_str() {
            "image" => [&song.image_url, &song.source_image_url]
                .iter().filter_map(|u| u.as_ref().filter(|s| !s.is_empty()).cloned()).collect(),
            _ => [&song.audio_url, &song.source_audio_url, &song.stream_audio_url]
                .iter().filter_map(|u| u.as_ref().filter(|s| !s.is_empty()).cloned()).collect(),
        };
        if urls.is_empty() {
            return Err((StatusCode::NOT_FOUND, "URL not available".to_string()));
        }
        urls
    };

    // Try each URL until one succeeds (Suno CDN may require Referer to avoid 403)
    let mut last_err = String::new();
    let mut resp = None;
    for url in &urls {
        match state.http_client.get(url)
            .header("Referer", "https://suno.com/")
            .send().await
        {
            Ok(r) if r.status().is_success() => { resp = Some(r); break; }
            Ok(r) => { last_err = format!("{} returned {}", url, r.status()); }
            Err(e) => { last_err = format!("{}: {}", url, e); }
        }
    }
    let resp = resp.ok_or_else(|| {
        tracing::warn!("All download URLs failed: {}", last_err);
        (StatusCode::BAD_GATEWAY, "Failed to download file".to_string())
    })?;

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Download failed: {}", e)))?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, content_type),
            (axum::http::header::CACHE_CONTROL, "private, max-age=600".to_string()),
        ],
        bytes,
    ).into_response())
}

/// POST /api/suno/lyrics-callback — webhook for lyrics generation
pub async fn lyrics_callback(
    State(state): State<AppState>,
    Json(payload): Json<SunoCallbackPayload>,
) -> Result<StatusCode, (StatusCode, String)> {
    let task_id = match &payload.task_id {
        Some(id) if !id.is_empty() => id.clone(),
        _ => return Ok(StatusCode::OK),
    };

    // Only accept callbacks for tasks we initiated
    let mut cache = state.suno_lyrics_cache.write().await;
    if !cache.contains_key(&task_id) {
        tracing::warn!("Suno lyrics callback for unknown task_id: {}", task_id);
        return Ok(StatusCode::OK);
    }

    if let Some(data) = payload.data {
        tracing::info!("Suno lyrics callback: task={}", task_id);
        cache.insert(task_id, data);

        // Simple size limit
        if cache.len() > 500 {
            let keys: Vec<String> = cache
                .keys()
                .take(100)
                .cloned()
                .collect();
            for key in keys {
                cache.remove(&key);
            }
        }
    }

    Ok(StatusCode::OK)
}
