use axum::{
    extract::{Multipart, State},
    http::{Extensions, StatusCode},
    Json,
};
use borsh::BorshSerialize;
use near_crypto::{InMemorySigner, SecretKey};
use near_jsonrpc_client::{methods, JsonRpcClient};
use near_primitives::hash::CryptoHash;
use near_primitives::transaction::{Action, FunctionCallAction, Transaction, TransactionV0};
use near_primitives::types::{AccountId, BlockReference, Finality};
use sha2::{Digest, Sha256};

use crate::{auth::jwt::require_auth, AppState};

const CHUNK_SIZE: usize = 1 << 20; // 1 MB
const MAX_FILE_SIZE: usize = 25 * 1024 * 1024; // 25 MB

// ── Borsh FastFS schemas (matches outlayer-cli and frontend fastfs.ts) ──

#[derive(BorshSerialize)]
struct FastfsFileContent {
    mime_type: String,
    content: Vec<u8>,
}

#[derive(BorshSerialize)]
struct SimpleFastfs {
    relative_path: String,
    content: Option<FastfsFileContent>,
}

#[derive(BorshSerialize)]
struct PartialFastfs {
    relative_path: String,
    offset: u32,
    full_size: u32,
    mime_type: String,
    content_chunk: Vec<u8>,
    nonce: u32,
}

fn encode_simple(path: &str, mime: &str, data: &[u8]) -> Vec<u8> {
    let simple = SimpleFastfs {
        relative_path: path.to_string(),
        content: Some(FastfsFileContent {
            mime_type: mime.to_string(),
            content: data.to_vec(),
        }),
    };
    let mut buf = vec![0u8]; // enum variant 0 = Simple
    buf.extend(borsh::to_vec(&simple).expect("borsh"));
    buf
}

fn encode_partial(path: &str, mime: &str, chunk: &[u8], offset: u32, full_size: u32, nonce: u32) -> Vec<u8> {
    let partial = PartialFastfs {
        relative_path: path.to_string(),
        offset,
        full_size,
        mime_type: mime.to_string(),
        content_chunk: chunk.to_vec(),
        nonce,
    };
    let mut buf = vec![1u8]; // enum variant 1 = Partial
    buf.extend(borsh::to_vec(&partial).expect("borsh"));
    buf
}

// ── NEAR transaction signing (using near-primitives, same as outlayer-cli) ──

struct NearSigner {
    client: JsonRpcClient,
    signer: InMemorySigner,
}

impl NearSigner {
    fn new(rpc_url: &str, account_id: &str, private_key: &str) -> Result<Self, String> {
        let account_id: AccountId = account_id.parse()
            .map_err(|e| format!("Invalid account_id: {}", e))?;
        let secret_key: SecretKey = private_key.parse()
            .map_err(|e| format!("Invalid private key: {}", e))?;
        let signer = InMemorySigner::from_secret_key(account_id, secret_key);
        let client = JsonRpcClient::connect(rpc_url);
        Ok(Self { client, signer })
    }

    /// Get current access key nonce and latest block hash.
    async fn get_tx_context(&self) -> Result<(u64, CryptoHash), String> {
        let access_key_query = methods::query::RpcQueryRequest {
            block_reference: BlockReference::Finality(Finality::Final),
            request: near_primitives::views::QueryRequest::ViewAccessKey {
                account_id: self.signer.account_id.clone(),
                public_key: self.signer.public_key(),
            },
        };

        let access_key_response = self.client.call(access_key_query).await
            .map_err(|e| format!("Failed to query access key: {}", e))?;

        let current_nonce = match access_key_response.kind {
            near_jsonrpc_primitives::types::query::QueryResponseKind::AccessKey(ak) => ak.nonce,
            _ => return Err("Unexpected query response for access key".to_string()),
        };

        let block = self.client.call(methods::block::RpcBlockRequest {
            block_reference: BlockReference::Finality(Finality::Final),
        }).await
            .map_err(|e| format!("Failed to query block: {}", e))?;

        Ok((current_nonce, block.header.hash))
    }

    /// Send a function call and wait for it to be included in a block.
    /// For gas=1 tx, execution will fail (expected) but the tx is recorded on-chain.
    async fn send_function_call(
        &self,
        receiver_id: &AccountId,
        method_name: &str,
        args: Vec<u8>,
        gas: u64,
        deposit: u128,
        nonce: u64,
        block_hash: CryptoHash,
    ) -> Result<CryptoHash, String> {
        let transaction_v0 = TransactionV0 {
            signer_id: self.signer.account_id.clone(),
            public_key: self.signer.public_key(),
            nonce,
            receiver_id: receiver_id.clone(),
            block_hash,
            actions: vec![Action::FunctionCall(Box::new(FunctionCallAction {
                method_name: method_name.to_string(),
                args,
                gas,
                deposit,
            }))],
        };

        let transaction = Transaction::V0(transaction_v0);
        let (tx_hash_computed, _) = transaction.get_hash_and_size();
        let signature = self.signer.sign(tx_hash_computed.as_ref());
        let signed_transaction =
            near_primitives::transaction::SignedTransaction::new(signature, transaction);

        // Use broadcast_tx_commit — waits for tx to be included and executed.
        // For gas=1 tx, execution fails with "Exceeded prepaid gas" but
        // the data is still recorded on-chain (which is what FastFS needs).
        let outcome = self.client
            .call(methods::broadcast_tx_commit::RpcBroadcastTxCommitRequest { signed_transaction })
            .await;

        match outcome {
            Ok(result) => {
                Ok(result.transaction_outcome.id)
            }
            Err(e) => {
                let err_str = format!("{:?}", e);
                // "InvalidTxError" or execution failures are expected for gas=1
                // The tx is still recorded — extract hash from error if possible
                if err_str.contains("Exceeded the prepaid gas") || err_str.contains("ActionError") {
                    Ok(tx_hash_computed)
                } else {
                    Err(format!("Failed to broadcast tx: {}", err_str))
                }
            }
        }
    }
}

// ── Helpers ──

fn mime_to_ext(mime: &str) -> &str {
    match mime {
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/mp4" => "mp4",
        "audio/webm" => "webm",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "application/octet-stream" => "mp3",
        _ => {
            let ext = mime.split('/').nth(1).unwrap_or("bin");
            if ext == "mpeg" { "mp3" } else { ext }
        }
    }
}

fn compute_sha256(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// Check NEAR account balance via RPC.
async fn check_relayer_balance(rpc_url: &str, account_id: &str) -> Result<u128, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0", "id": "1", "method": "query",
            "params": { "request_type": "view_account", "finality": "final", "account_id": account_id }
        }))
        .send().await
        .map_err(|e| format!("RPC failed: {}", e))?;
    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("RPC parse failed: {}", e))?;
    if let Some(err) = json.get("error") {
        return Err(format!("Account error: {}", err));
    }
    json["result"]["amount"].as_str().unwrap_or("0")
        .parse::<u128>().map_err(|e| format!("Parse balance: {}", e))
}

// ── API endpoint ──

#[derive(serde::Serialize)]
pub struct UploadResponse {
    pub url: String,
    pub hash: String,
    pub relative_path: String,
}

/// POST /api/fastfs/upload — upload a file to FastFS via server-side relayer.
/// For users without a NEAR wallet (Solana, Google).
pub async fn upload(
    State(state): State<AppState>,
    extensions: Extensions,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, (StatusCode, String)> {
    let claims = require_auth(&extensions)
        .map_err(|s| (s, "Authentication required".to_string()))?;

    // Per-user rate limit: max 10 uploads per hour
    let recent_uploads: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM songs WHERE uploader_id = $1 AND created_at > NOW() - INTERVAL '1 hour'"
    )
    .bind(claims.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if recent_uploads.0 >= 10 {
        return Err((StatusCode::TOO_MANY_REQUESTS, "Upload limit reached (10 per hour). Try again later.".to_string()));
    }

    let relayer_account = state.config.fastfs_relayer_account_id.as_ref()
        .ok_or_else(|| (StatusCode::SERVICE_UNAVAILABLE, "FastFS relayer not configured".to_string()))?;
    let relayer_key_str = state.config.fastfs_relayer_private_key.as_ref()
        .ok_or_else(|| (StatusCode::SERVICE_UNAVAILABLE, "FastFS relayer key not configured".to_string()))?;

    // Check relayer balance
    let relayer_rpc_for_balance = state.config.fastfs_relayer_rpc_url.as_deref()
        .unwrap_or(&state.config.near_rpc_url);
    let balance = check_relayer_balance(relayer_rpc_for_balance, relayer_account).await
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, format!("Relayer check failed: {}", e)))?;
    if balance < 100_000_000_000_000_000_000_000 { // 0.1 NEAR
        tracing::error!(relayer = %relayer_account, balance, "Relayer balance too low");
        return Err((StatusCode::SERVICE_UNAVAILABLE, "Upload service temporarily unavailable. Please contact support.".to_string()));
    }

    // Initialize NEAR signer with dedicated relayer RPC (may have API key)
    let relayer_rpc = state.config.fastfs_relayer_rpc_url.as_deref()
        .unwrap_or(&state.config.near_rpc_url);
    let signer = NearSigner::new(relayer_rpc, relayer_account, relayer_key_str)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Signer init failed: {}", e)))?;

    // Read file from multipart
    let mut file_data: Option<(String, Vec<u8>)> = None;
    while let Some(field) = multipart.next_field().await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Multipart error: {}", e)))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            let mime = field.content_type().unwrap_or("application/octet-stream").to_string();
            let data = field.bytes().await
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Read error: {}", e)))?;
            if data.len() > MAX_FILE_SIZE {
                return Err((StatusCode::PAYLOAD_TOO_LARGE, format!("File too large (max {}MB)", MAX_FILE_SIZE / 1024 / 1024)));
            }
            file_data = Some((mime, data.to_vec()));
        }
    }

    let (mime_type, data) = file_data
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "No file field in request".to_string()))?;

    // Compute hash + relative path
    let hash = compute_sha256(&data);
    let ext = mime_to_ext(&mime_type);
    let relative_path = format!("{}.{}", hash, ext);
    let receiver_id: AccountId = state.config.contract_id.parse()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid contract_id: {}", e)))?;

    // Prepare FastFS payloads
    let payloads: Vec<Vec<u8>> = if data.len() <= CHUNK_SIZE {
        vec![encode_simple(&relative_path, &mime_type, &data)]
    } else {
        let nonce = (chrono::Utc::now().timestamp() - 1769376240) as u32;
        let full_size = data.len() as u32;
        data.chunks(CHUNK_SIZE)
            .enumerate()
            .map(|(i, chunk)| encode_partial(&relative_path, &mime_type, chunk, (i * CHUNK_SIZE) as u32, full_size, nonce))
            .collect()
    };

    // Lock to prevent nonce race conditions between parallel uploads
    let _upload_guard = state.fastfs_upload_lock.lock().await;

    // Get nonce + block hash
    let (current_nonce, block_hash) = signer.get_tx_context().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("TX context failed: {}", e)))?;

    // Send each payload as a NEAR transaction.
    // Use broadcast_tx_commit to wait for each chunk before sending the next.
    let num_payloads = payloads.len();
    for (i, payload) in payloads.iter().enumerate() {
        // Get fresh context for each chunk (nonce advances after each confirmed tx)
        let (chunk_nonce, chunk_block_hash) = if i > 0 {
            signer.get_tx_context().await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("TX context failed: {}", e)))?
        } else {
            (current_nonce, block_hash)
        };

        match signer.send_function_call(
            &receiver_id,
            "__fastdata_fastfs",
            payload.clone(),
            1, // gas=1: intentionally fails, but data is recorded on-chain
            0, // no deposit
            chunk_nonce + 1,
            chunk_block_hash,
        ).await {
            Ok(tx_hash) => {
                tracing::info!(
                    relayer = %relayer_account,
                    part = i + 1,
                    total = num_payloads,
                    %tx_hash,
                    "FastFS upload part sent"
                );
            }
            Err(e) => {
                tracing::error!(relayer = %relayer_account, part = i + 1, "FastFS upload failed: {}", e);
                return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Upload failed at part {}: {}", i + 1, e)));
            }
        }
    }

    let url = format!("https://main.fastfs.io/{}/{}/{}", relayer_account, state.config.contract_id, relative_path);

    Ok(Json(UploadResponse { url, hash, relative_path }))
}
