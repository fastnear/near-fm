//! Shared OutLayer money-operation client.
//!
//! From API spec 0.1.0-alpha.3, money operations (payment-check create / claim /
//! reclaim, withdraw, swap, transfer) run to their outcome even if the
//! connection drops, and a 200 can answer `status: "processing"` (or
//! `"creating"` for a check create) with a `poll_url` to follow. Final statuses:
//! `success` / `completed`, `failed`, `refunded`, `needs_review`. A re-sent
//! `X-Idempotency-Key` runs nothing and answers the request it belongs to
//! (HTTP 200 with `error: duplicate_idempotency_key`), so every write here
//! carries a key, and a transport error is retried under the same key.
//!
//! All of this also works against the pre-release server, which answers the
//! result fields without a `status` — an absent status on a 2xx is final.

use serde_json::Value;
use sha2::{Digest, Sha256};

const DEFAULT_OUTLAYER_API: &str = "https://api.outlayer.ai";

/// OutLayer API base URL: `OUTLAYER_API_URL` env, else the default host.
pub fn api_base() -> &'static str {
    static BASE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    BASE.get_or_init(|| {
        std::env::var("OUTLAYER_API_URL")
            .ok()
            .filter(|v| !v.is_empty())
            .map(|v| v.trim_end_matches('/').to_string())
            .unwrap_or_else(|| DEFAULT_OUTLAYER_API.to_string())
    })
}

/// Ask the API to answer `processing` within this many seconds instead of
/// outliving our edge: nginx cuts non-suno routes at 60 s, and one route can
/// make several money calls.
const ANSWER_WITHIN_SECS: u32 = 15;
/// How often a `processing` request is polled.
const POLL_EVERY: std::time::Duration = if cfg!(test) {
    std::time::Duration::from_millis(30)
} else {
    std::time::Duration::from_secs(2)
};
/// Transport-level retries of one send, under the same idempotency key — the
/// duplicate answer resolves what the lost answer said.
const SEND_TRIES: u32 = 3;
/// Claims that ended `failed` + `never_executed` are re-run under a fresh key
/// at most this many times.
const CLAIM_ATTEMPTS: u32 = 3;

/// What one money-operation answer (or one poll of its request) tells us.
#[derive(Debug)]
pub enum Outcome {
    /// Final success. The body is the answer (or the polled request) itself.
    Final(Value),
    /// Still running when our budget ran out. `body` is the FIRST answer (it
    /// carries fields like `check_key` that the polled request may not).
    Processing { body: Value, poll_url: Option<String> },
    /// The request never executed — nothing moved; retry under a NEW key.
    NeverExecuted { request_id: String },
    /// Over without the money arriving (or `refunded`). Funds MAY have moved
    /// (e.g. a partial bridge) — do not tell the user "nothing happened".
    Failed(String),
    /// The outcome could not be established. Do not retry, alert a human.
    NeedsReview(String),
}

/// Deterministic idempotency key from stable parts: a re-send is a re-send.
pub fn idem_key(parts: &[&str]) -> String {
    let mut h = Sha256::new();
    h.update(b"near-fm:");
    for p in parts {
        h.update(p.as_bytes());
        h.update(b":");
    }
    hex::encode(&h.finalize()[..16])
}

/// Fresh key for an operation with no natural identity (a new check, a new
/// withdrawal): minted once per invocation, reused across its own retries.
pub fn fresh_idem_key() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn str_of(v: &Value) -> Option<String> {
    v.as_str().map(|s| s.to_string())
}

/// The claimed amount of a claim answer or its polled request.
pub fn amount_claimed(body: &Value) -> Option<String> {
    str_of(&body["amount_claimed"]).or_else(|| str_of(&body["result"]["amount_claimed"]))
}

/// Classify one 2xx body. `poll_url` fallbacks to `request_id`.
fn classify(body: &Value) -> Outcome {
    // A 200 with an `error` is only final knowledge when it is the duplicate
    // answer, which carries the request's own fields and falls through.
    if let Some(err) = body["error"].as_str() {
        if err != "duplicate_idempotency_key" {
            return Outcome::Failed(format!("{}: {}", err, body["message"].as_str().unwrap_or("")));
        }
    }
    let status = body["status"].as_str().unwrap_or("");
    match status {
        // Pre-release compatibility: a 2xx without `status` is the result.
        "" => Outcome::Final(body.clone()),
        "success" | "completed" | "claimed" | "partially_claimed" | "unclaimed" | "reclaimed" => {
            Outcome::Final(body.clone())
        }
        "processing" | "creating" | "pending" => {
            let poll_url = str_of(&body["poll_url"])
                .or_else(|| str_of(&body["request_id"]).map(|id| format!("/wallet/v1/requests/{id}")));
            Outcome::Processing { body: body.clone(), poll_url }
        }
        "failed" => {
            let never = body["result"]["never_executed"].as_bool().unwrap_or(false)
                || body["result"]["never_submitted"].as_bool().unwrap_or(false);
            match (never, str_of(&body["request_id"])) {
                (true, Some(request_id)) => Outcome::NeverExecuted { request_id },
                _ => Outcome::Failed(body["result"].to_string()),
            }
        }
        "refunded" => Outcome::Failed(format!("refunded: {}", body["result"])),
        "needs_review" => Outcome::NeedsReview(body["request_id"].as_str().unwrap_or("?").to_string()),
        other => Outcome::Failed(format!("unexpected status {other:?}: {}", body["result"])),
    }
}

async fn get_request(client: &reqwest::Client, api_key: &str, poll_url: &str) -> Result<Value, String> {
    let url = if poll_url.starts_with('/') {
        format!("{}{poll_url}", api_base())
    } else {
        poll_url.to_string()
    };
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("OutLayer poll failed: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("OutLayer poll parse: {e}"))?;
    if !status.is_success() {
        return Err(format!("OutLayer poll {status}: {body}"));
    }
    Ok(body)
}

/// Follows a `processing` request for up to `budget`. Still processing at the
/// end → `Processing` again (with the original first answer as the body).
async fn follow(
    client: &reqwest::Client,
    api_key: &str,
    first_body: Value,
    poll_url: String,
    budget: std::time::Duration,
) -> Result<Outcome, String> {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        tokio::time::sleep(POLL_EVERY).await;
        let polled = get_request(client, api_key, &poll_url).await?;
        match classify(&polled) {
            Outcome::Processing { .. } if tokio::time::Instant::now() < deadline => continue,
            Outcome::Processing { .. } => {
                return Ok(Outcome::Processing { body: first_body, poll_url: Some(poll_url) })
            }
            // `Final` of a poll is the request; carry over the first answer's
            // check identity, which the request body may not repeat.
            Outcome::Final(mut v) => {
                for k in ["check_key", "check_id"] {
                    if v.get(k).map_or(true, Value::is_null) && !first_body[k].is_null() {
                        v[k] = first_body[k].clone();
                    }
                }
                return Ok(Outcome::Final(v));
            }
            outcome => return Ok(outcome),
        }
    }
}

/// POST one money operation and run it to an outcome, following `processing`
/// for up to `follow_secs`. A transport error re-sends the SAME key: nothing
/// runs twice, the duplicate answer tells us where the request is.
pub async fn execute(
    client: &reqwest::Client,
    api_key: &str,
    path: &str,
    body: &Value,
    idem: &str,
    follow_secs: u64,
) -> Result<Outcome, String> {
    let mut last_err = String::new();
    for attempt in 0..SEND_TRIES {
        if attempt > 0 {
            tokio::time::sleep(POLL_EVERY).await;
        }
        let resp = client
            .post(format!("{}{path}", api_base()))
            .header("Authorization", format!("Bearer {api_key}"))
            .header("X-Idempotency-Key", idem)
            .header("X-Answer-Within", ANSWER_WITHIN_SECS.to_string())
            .json(body)
            .send()
            .await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("OutLayer {path}: {e}");
                continue; // same key: safe
            }
        };
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

        if status == reqwest::StatusCode::CONFLICT && json["error"].as_str() == Some("wallet_busy") {
            // Our own or a neighbouring request holds the wallet; re-send the
            // same key shortly — the duplicate answer resolves ours.
            last_err = format!("OutLayer {path}: wallet_busy");
            continue;
        }
        if !status.is_success() {
            // A refusal before the reserve holds nothing; no blind retry.
            return Err(format!(
                "OutLayer {path} {status}: {}",
                if text.len() > 300 { &text[..300] } else { &text }
            ));
        }
        return match classify(&json) {
            Outcome::Processing { body: first, poll_url: Some(url) } if follow_secs > 0 => {
                follow(client, api_key, first, url, std::time::Duration::from_secs(follow_secs)).await
            }
            outcome => Ok(outcome),
        };
    }
    Err(last_err)
}

/// Claim a payment check into `api_key`'s wallet and answer the claimed
/// amount. `idem_parts` names the operation (who claims what, for which
/// purpose) so a user's or agent's retry re-reads instead of double-claiming.
/// A claim that never executed is re-run under the next derived key.
///
/// `Err((retryable, message))`: `retryable: true` means the caller may answer
/// "try again shortly" (still processing after the budget — the money is on
/// its way, the same call later picks the request up); `false` is final.
pub async fn claim_check(
    client: &reqwest::Client,
    api_key: &str,
    check_key: &str,
    amount: Option<&str>,
    idem_parts: &[&str],
    follow_secs: u64,
) -> Result<Value, (bool, String)> {
    let mut body = serde_json::json!({ "check_key": check_key });
    if let Some(a) = amount {
        body["amount"] = Value::String(a.to_string());
    }
    let mut prev_failed: Option<String> = None;
    for _ in 0..CLAIM_ATTEMPTS {
        let mut parts: Vec<&str> = idem_parts.to_vec();
        if let Some(ref p) = prev_failed {
            parts.push(p);
        }
        let idem = idem_key(&parts);
        match execute(client, api_key, "/wallet/v1/payment-check/claim", &body, &idem, follow_secs)
            .await
            .map_err(|e| (false, e))?
        {
            Outcome::Final(v) => return Ok(v),
            Outcome::Processing { .. } => {
                return Err((true, "The claim is still settling. Try again in a minute — the same request continues where it is.".to_string()))
            }
            Outcome::NeverExecuted { request_id } => {
                tracing::warn!(request_id = %request_id, "claim never executed; retrying under the next key");
                prev_failed = Some(request_id);
            }
            Outcome::Failed(why) => return Err((false, format!("Claim failed: {why}"))),
            Outcome::NeedsReview(id) => {
                return Err((false, format!("Claim outcome needs manual review (request {id}). Contact support — do not retry.")))
            }
        }
    }
    Err((false, "Claim never executed after several attempts".to_string()))
}

/// Create a payment check and answer `(check_key, final_body)` once funded.
/// A `creating` answer is followed; if still creating after the budget the
/// check_key is answered anyway with `funded: false` — the caller decides
/// whether to wait, abort, or reclaim later.
pub struct CreatedCheck {
    pub check_key: String,
    pub funded: bool,
}

pub async fn create_check(
    client: &reqwest::Client,
    api_key: &str,
    token: &str,
    amount: &str,
    memo: &str,
    follow_secs: u64,
) -> Result<CreatedCheck, String> {
    let body = serde_json::json!({ "token": token, "amount": amount, "memo": memo });
    let idem = fresh_idem_key();
    match execute(client, api_key, "/wallet/v1/payment-check/create", &body, &idem, follow_secs).await? {
        Outcome::Final(v) => match str_of(&v["check_key"]) {
            Some(check_key) => Ok(CreatedCheck { check_key, funded: true }),
            None => Err("check created without a check_key".to_string()),
        },
        Outcome::Processing { body, .. } => match str_of(&body["check_key"]) {
            Some(check_key) => Ok(CreatedCheck { check_key, funded: false }),
            None => Err("check creating without a check_key".to_string()),
        },
        Outcome::NeverExecuted { .. } => Err("check create never executed — retry".to_string()),
        Outcome::Failed(why) => Err(format!("check create failed: {why}")),
        Outcome::NeedsReview(id) => Err(format!("check create needs review (request {id})")),
    }
}

/// Reclaim whatever remains on a check, best effort: used to hand funds back
/// after a downstream failure. Never-executed is retried once under a new key.
pub async fn reclaim_check(client: &reqwest::Client, api_key: &str, check_key: &str, purpose: &str) {
    let body = serde_json::json!({ "check_key": check_key });
    for salt in ["", "retry"] {
        let idem = idem_key(&["reclaim", purpose, &hex::encode(Sha256::digest(check_key.as_bytes())), salt]);
        match execute(client, api_key, "/wallet/v1/payment-check/reclaim", &body, &idem, 20).await {
            Ok(Outcome::NeverExecuted { .. }) => continue,
            Ok(Outcome::Failed(why)) => {
                tracing::warn!(purpose, "reclaim failed: {}", why);
                return;
            }
            Ok(_) => return,
            Err(e) => {
                tracing::warn!(purpose, "reclaim error: {}", e);
                return;
            }
        }
    }
}

/// Background reclaim of a check that could not be reclaimed yet (still
/// `creating`, or the relay was busy): retried for ~10 minutes. Each attempt
/// that the API refuses before its reserve holds nothing, so a fresh key per
/// attempt is safe; one that is running (`processing`) is left to finish.
pub fn reclaim_later(client: reqwest::Client, api_key: String, check_key: String, purpose: String) {
    tokio::spawn(async move {
        let hash = hex::encode(Sha256::digest(check_key.as_bytes()));
        let body = serde_json::json!({ "check_key": check_key });
        for attempt in 0..20u32 {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let idem = idem_key(&["reclaim-later", &purpose, &hash, &attempt.to_string()]);
            match execute(&client, &api_key, "/wallet/v1/payment-check/reclaim", &body, &idem, 60).await {
                Ok(Outcome::Final(_)) | Ok(Outcome::Processing { .. }) => {
                    tracing::info!(purpose = %purpose, attempt, "deferred reclaim done");
                    return;
                }
                Ok(Outcome::NeverExecuted { .. }) | Err(_) => continue,
                Ok(Outcome::Failed(why)) => {
                    // A check that ended `failed` was never funded: nothing to return.
                    tracing::warn!(purpose = %purpose, "deferred reclaim: {}", why);
                    return;
                }
                Ok(Outcome::NeedsReview(id)) => {
                    tracing::error!(purpose = %purpose, request_id = %id, "deferred reclaim needs review");
                    return;
                }
            }
        }
        tracing::error!(purpose = %purpose, "deferred reclaim gave up after 20 attempts — funds held in check");
    });
}

/// One claimant of a check: who claims, how much (None = all that remains),
/// and a label that makes its idempotency key unique within the payment.
pub struct Leg {
    pub api_key: String,
    pub amount: Option<String>,
    pub label: String,
}

/// Pay from `from_key` through a fresh payment check claimed by `legs`, in
/// order. The first leg is the payment itself: if it fails for good the check
/// is reclaimed to the payer and the whole call fails. Later legs (commission,
/// refund shares) are answered per leg for the caller to log; if any of them
/// fails, or `reclaim_rest` is set, what remains on the check goes back to the
/// payer instead of sitting in it.
///
/// Only ever credit / record on `Ok`: every leg-0 claim it answers is final.
/// `Err((true, _))`: the payment claim is still in flight — money may arrive;
/// do not release locks or tell the user nothing moved.
pub async fn pay_via_check(
    client: &reqwest::Client,
    from_key: &str,
    token: &str,
    amount: &str,
    memo: &str,
    purpose: &str,
    legs: &[Leg],
    reclaim_rest: bool,
) -> Result<Vec<Result<Value, (bool, String)>>, (bool, String)> {
    let created = create_check(client, from_key, token, amount, memo, FLOW_FOLLOW_SECS)
        .await
        .map_err(|e| (false, e))?;
    if !created.funded {
        reclaim_later(client.clone(), from_key.to_string(), created.check_key, purpose.to_string());
        return Err((false, "Payment check is still being funded; it will be returned to your balance shortly.".to_string()));
    }
    let check_hash = hex::encode(Sha256::digest(created.check_key.as_bytes()));
    let mut results = Vec::with_capacity(legs.len());
    let mut secondary_failed = false;
    for (i, leg) in legs.iter().enumerate() {
        let r = claim_check(
            client,
            &leg.api_key,
            &created.check_key,
            leg.amount.as_deref(),
            &["pay", purpose, &check_hash, &leg.label],
            FLOW_FOLLOW_SECS,
        )
        .await;
        if i == 0 {
            if let Err((retryable, ref why)) = r {
                if retryable {
                    // Money is on its way to the claimant: never reclaim under it.
                    tracing::error!(purpose, "claim still processing after follow window: {}", why);
                } else {
                    tracing::warn!(purpose, "claim failed, reclaiming to payer: {}", why);
                    reclaim_check(client, from_key, &created.check_key, purpose).await;
                }
                return Err((retryable, why.clone()));
            }
        } else if let Err((retryable, ref why)) = r {
            tracing::warn!(purpose, leg = %leg.label, "secondary claim failed: {}", why);
            // A still-processing claim holds its share; reclaiming the rest
            // around it is safe, the API reserves per claim.
            secondary_failed |= !retryable;
        }
        results.push(r);
    }
    if reclaim_rest || secondary_failed {
        reclaim_check(client, from_key, &created.check_key, purpose).await;
    }
    Ok(results)
}

/// How long a detached money flow follows a `processing` request. The route
/// itself answers after `ROUTE_WAIT`; the flow keeps going in the background.
pub const FLOW_FOLLOW_SECS: u64 = 240;
/// How long a route waits for its detached money flow before answering 202.
/// Under nginx's 60 s `proxy_read_timeout` for /api/.
pub const ROUTE_WAIT: std::time::Duration = std::time::Duration::from_secs(45);

/// 202 answer for a money flow that is still running in the background.
pub fn processing_response(message: &str) -> axum::response::Response {
    use axum::response::IntoResponse;
    (
        axum::http::StatusCode::ACCEPTED,
        axum::Json(serde_json::json!({ "status": "processing", "message": message })),
    )
        .into_response()
}

/// Run `fut` to completion even if our caller's connection is dropped, waiting
/// up to `wait` for the result. `None`: still running (it will finish in the
/// background — the future must do its own logging / DB writes).
pub async fn detached<T: Send + 'static>(
    fut: impl std::future::Future<Output = T> + Send + 'static,
    wait: std::time::Duration,
) -> Option<T> {
    let handle = tokio::spawn(fut);
    match tokio::time::timeout(wait, handle).await {
        Ok(Ok(v)) => Some(v),
        Ok(Err(join_err)) => {
            tracing::error!("detached money task panicked: {join_err}");
            None
        }
        Err(_elapsed) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn is_final(v: &Value) -> bool {
        matches!(classify(v), Outcome::Final(_))
    }

    #[test]
    fn processing_is_never_final_even_with_amounts() {
        let v = json!({"status": "processing", "request_id": "r1", "amount_claimed": "5"});
        assert!(matches!(classify(&v), Outcome::Processing { .. }));
        let v = json!({"status": "creating", "check_key": "ck", "poll_url": "/wallet/v1/requests/r2"});
        assert!(matches!(classify(&v), Outcome::Processing { .. }));
    }

    #[test]
    fn final_statuses_and_pre_release_bodies_are_final() {
        for s in ["success", "completed", "claimed", "partially_claimed", "unclaimed", "reclaimed"] {
            assert!(is_final(&json!({"status": s})), "{s} must be final");
        }
        // Pre-release answer: result fields, no status.
        assert!(is_final(&json!({"amount_claimed": "5", "remaining": "0"})));
    }

    #[test]
    fn duplicate_key_answer_reads_as_its_request() {
        let done = json!({"error": "duplicate_idempotency_key", "message": "already processed",
                          "request_id": "r1", "status": "completed", "result": {"amount_claimed": "9"}});
        assert!(is_final(&done));
        assert_eq!(amount_claimed(&done).as_deref(), Some("9"));
        let never = json!({"error": "duplicate_idempotency_key", "request_id": "r1",
                           "status": "failed", "result": {"never_executed": true}});
        assert!(matches!(classify(&never), Outcome::NeverExecuted { ref request_id } if request_id == "r1"));
        let other_error = json!({"error": "invalid_check", "message": "no such check"});
        assert!(matches!(classify(&other_error), Outcome::Failed(_)));
    }

    #[test]
    fn failed_moves_are_told_apart_from_never_executed() {
        let never = json!({"status": "failed", "request_id": "r1", "result": {"never_submitted": true}});
        assert!(matches!(classify(&never), Outcome::NeverExecuted { .. }));
        let moved = json!({"status": "failed", "request_id": "r1", "result": {"reason": "bridge refund"}});
        assert!(matches!(classify(&moved), Outcome::Failed(_)));
        let review = json!({"status": "needs_review", "request_id": "r1"});
        assert!(matches!(classify(&review), Outcome::NeedsReview(_)));
        let refunded = json!({"status": "refunded", "request_id": "r1", "result": {}});
        assert!(matches!(classify(&refunded), Outcome::Failed(_)));
    }

    #[test]
    fn keys_are_deterministic_and_distinct() {
        assert_eq!(idem_key(&["credits-topup", "7", "hash"]), idem_key(&["credits-topup", "7", "hash"]));
        assert_ne!(idem_key(&["credits-topup", "7", "hash"]), idem_key(&["credits-topup", "8", "hash"]));
        assert_ne!(idem_key(&["credits-topup", "7", "hash"]), idem_key(&["premium", "7", "hash"]));
        // Ambiguity across part boundaries is broken by the separator.
        assert_ne!(idem_key(&["ab", "c"]), idem_key(&["a", "bc"]));
        assert_eq!(idem_key(&["x"]).len(), 32);
        assert_ne!(fresh_idem_key(), fresh_idem_key());
    }

    #[test]
    fn amount_claimed_reads_answer_and_request_shapes() {
        assert_eq!(amount_claimed(&json!({"amount_claimed": "5"})).as_deref(), Some("5"));
        assert_eq!(amount_claimed(&json!({"result": {"amount_claimed": "7"}})).as_deref(), Some("7"));
        assert_eq!(amount_claimed(&json!({"status": "processing"})), None);
    }
}


/// End-to-end scenarios against a mock OutLayer API (real HTTP, no money).
#[cfg(test)]
mod mock_api_tests {
    use super::*;
    use axum::{
        body::Bytes,
        extract::State as AxState,
        http::{HeaderMap, Method, StatusCode as Sc, Uri},
        response::IntoResponse,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct Mock {
        /// (method, path, check_key, idempotency key, answer-within)
        calls: Vec<(String, String, String, String, String)>,
        counters: HashMap<String, u32>,
    }
    type Shared = Arc<Mutex<Mock>>;

    async fn handle(
        AxState(m): AxState<Shared>,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
    ) -> axum::response::Response {
        let path = uri.path().to_string();
        let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        let ck = body["check_key"].as_str().unwrap_or("").to_string();
        let h = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let mut m = m.lock().unwrap();
        m.calls.push((method.to_string(), path.clone(), ck.clone(), h("x-idempotency-key"), h("x-answer-within")));
        let key = format!("{path}|{ck}");
        let n = { let c = m.counters.entry(key).or_insert(0); *c += 1; *c };
        let ok = |v: Value| (Sc::OK, axum::Json(v)).into_response();

        match (method.as_str(), path.as_str(), ck.as_str()) {
            // claim: processing, then the request completes on the 2nd poll
            ("POST", "/wallet/v1/payment-check/claim", "ck-processing") => ok(json!({
                "status": "processing", "request_id": "r1", "poll_url": "/wallet/v1/requests/r1", "amount_claimed": "5"})),
            ("GET", "/wallet/v1/requests/r1", _) => if n < 2 {
                ok(json!({"status": "processing", "request_id": "r1"}))
            } else {
                ok(json!({"status": "completed", "request_id": "r1", "result": {"amount_claimed": "5000000"}}))
            },
            ("POST", "/wallet/v1/payment-check/claim", "ck-dup") => ok(json!({
                "error": "duplicate_idempotency_key", "message": "Request already processed",
                "request_id": "r2", "type": "payment_check_claim", "status": "completed",
                "result": {"amount_claimed": "7"}})),
            ("POST", "/wallet/v1/payment-check/claim", "ck-never") => if n == 1 {
                ok(json!({"status": "failed", "request_id": "r3", "result": {"never_executed": true}}))
            } else {
                ok(json!({"status": "claimed", "amount_claimed": "9"}))
            },
            ("POST", "/wallet/v1/payment-check/claim", "ck-busy") => if n == 1 {
                (Sc::CONFLICT, axum::Json(json!({"error": "wallet_busy", "in_flight_request_id": null}))).into_response()
            } else {
                ok(json!({"status": "claimed", "amount_claimed": "3"}))
            },
            ("POST", "/wallet/v1/payment-check/claim", "ck-failed") => ok(json!({
                "status": "failed", "request_id": "r4", "result": {"reason": "bridge refunded"}})),
            ("POST", "/wallet/v1/payment-check/claim", "ck-review") => ok(json!({
                "status": "needs_review", "request_id": "r5"})),
            ("POST", "/wallet/v1/payment-check/claim", "ck-stuck") => ok(json!({
                "status": "processing", "request_id": "r6"})),
            ("GET", "/wallet/v1/requests/r6", _) => ok(json!({"status": "processing", "request_id": "r6"})),
            ("POST", "/wallet/v1/payment-check/claim", "ck-legacy") => ok(json!({"amount_claimed": "11", "remaining": "0"})),
            ("POST", "/wallet/v1/payment-check/claim", "ck-refused") =>
                (Sc::BAD_REQUEST, axum::Json(json!({"error": "invalid_check"}))).into_response(),
            // create: `creating`, funded on poll (poll body has no check_key)
            ("POST", "/wallet/v1/payment-check/create", _) => match body["memo"].as_str().unwrap_or("") {
                "creating" => ok(json!({"status": "creating", "check_key": "ck-created", "check_id": "c1",
                                        "request_id": "rc", "poll_url": "/wallet/v1/requests/rc"})),
                "claim-fails" => ok(json!({"status": "unclaimed", "check_key": "ck-failed", "check_id": "c2"})),
                _ => ok(json!({"check_key": "ck-legacy", "check_id": "c3", "amount": "11"})),
            },
            ("GET", "/wallet/v1/requests/rc", _) => ok(json!({"status": "completed", "request_id": "rc", "result": {}})),
            ("POST", "/wallet/v1/payment-check/claim", "ck-created") => ok(json!({"status": "claimed", "amount_claimed": "100"})),
            ("POST", "/wallet/v1/payment-check/reclaim", _) => ok(json!({"status": "reclaimed", "amount_reclaimed": "100"})),
            _ => (Sc::NOT_FOUND, "no scenario").into_response(),
        }
    }

    async fn start_mock() -> Shared {
        let shared: Shared = Arc::default();
        let app = axum::Router::new().fallback(handle).with_state(shared.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        std::env::set_var("OUTLAYER_API_URL", format!("http://{addr}"));
        assert_eq!(api_base(), format!("http://{addr}"), "base must be read after the mock starts");
        shared
    }

    fn keys_for(m: &Shared, path: &str, ck: &str) -> Vec<String> {
        m.lock().unwrap().calls.iter()
            .filter(|c| c.1 == path && c.2 == ck)
            .map(|c| c.3.clone())
            .collect()
    }

    /// One test so the process-wide base URL is set exactly once.
    #[tokio::test]
    async fn money_operations_against_mock_api() {
        let m = start_mock().await;
        let http = reqwest::Client::new();
        let claim = |ck: &'static str, follow: u64| {
            let http = http.clone();
            async move { claim_check(&http, "k", ck, None, &["t", ck], follow).await }
        };
        const CLAIM: &str = "/wallet/v1/payment-check/claim";

        // processing → followed until completed; amount from the request, not the processing answer
        let v = claim("ck-processing", 10).await.expect("processing claim settles");
        assert_eq!(amount_claimed(&v).as_deref(), Some("5000000"));

        // duplicate key answer is read as the request it names
        let v = claim("ck-dup", 10).await.unwrap();
        assert_eq!(amount_claimed(&v).as_deref(), Some("7"));

        // never_executed → retried under a NEW key
        let v = claim("ck-never", 10).await.unwrap();
        assert_eq!(amount_claimed(&v).as_deref(), Some("9"));
        let ks = keys_for(&m, CLAIM, "ck-never");
        assert_eq!(ks.len(), 2);
        assert_ne!(ks[0], ks[1], "a never-executed claim is retried under a new key");

        // wallet_busy → re-sent under the SAME key
        let v = claim("ck-busy", 10).await.unwrap();
        assert_eq!(amount_claimed(&v).as_deref(), Some("3"));
        let ks = keys_for(&m, CLAIM, "ck-busy");
        assert_eq!(ks.len(), 2);
        assert_eq!(ks[0], ks[1], "wallet_busy is retried under the same key");

        // failed (may have moved) / needs_review → final errors, not retryable, no re-send
        assert!(matches!(claim("ck-failed", 10).await, Err((false, _))));
        assert_eq!(keys_for(&m, CLAIM, "ck-failed").len(), 1);
        let e = claim("ck-review", 10).await.unwrap_err();
        assert!(!e.0 && e.1.contains("review"));
        assert_eq!(keys_for(&m, CLAIM, "ck-review").len(), 1);

        // still processing after the budget → retryable error (never credited)
        assert!(matches!(claim("ck-stuck", 1).await, Err((true, _))));

        // pre-release answer without status
        let v = claim("ck-legacy", 10).await.unwrap();
        assert_eq!(amount_claimed(&v).as_deref(), Some("11"));

        // 4xx refusal → error, no blind retry
        assert!(matches!(claim("ck-refused", 10).await, Err((false, _))));
        assert_eq!(keys_for(&m, CLAIM, "ck-refused").len(), 1);

        // every write carried an idempotency key and X-Answer-Within
        for c in m.lock().unwrap().calls.iter().filter(|c| c.0 == "POST") {
            assert_eq!(c.3.len(), 32, "idempotency key on {:?}", c);
            assert_eq!(c.4, ANSWER_WITHIN_SECS.to_string(), "answer-within on {:?}", c);
        }

        // pay_via_check: `creating` check followed to funded, check_key carried over the poll
        let leg = |label: &str| Leg { api_key: "treasury".into(), amount: None, label: label.into() };
        let r = pay_via_check(&http, "payer", "usdc", "100", "creating", "test", &[leg("t")], false).await;
        assert!(r.is_ok(), "{:?}", r.err());
        assert_eq!(keys_for(&m, CLAIM, "ck-created").len(), 1);

        // pay_via_check: leg-0 claim fails for good → check reclaimed to the payer
        let before = keys_for(&m, "/wallet/v1/payment-check/reclaim", "ck-failed").len();
        let r = pay_via_check(&http, "payer", "usdc", "100", "claim-fails", "test", &[leg("t")], false).await;
        assert!(matches!(r, Err((false, _))));
        assert_eq!(keys_for(&m, "/wallet/v1/payment-check/reclaim", "ck-failed").len(), before + 1);

        // detached: the flow finishes even though the caller stopped waiting
        let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let d = done.clone();
        let r = detached(async move {
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            d.store(true, std::sync::atomic::Ordering::SeqCst);
        }, std::time::Duration::from_millis(20)).await;
        assert!(r.is_none());
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert!(done.load(std::sync::atomic::Ordering::SeqCst), "detached flow kept running");
    }
}
