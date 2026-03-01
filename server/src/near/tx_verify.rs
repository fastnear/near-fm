use serde::Serialize;

const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_MS: u64 = 1000;

#[derive(Debug, Serialize)]
pub struct VerifiedTx {
    pub signer_id: String,
    pub receiver_id: String,
    pub method_name: String,
    /// Deposit in yoctoNEAR (as string to preserve precision)
    pub deposit: String,
    /// Decoded function call args as JSON
    pub args_json: serde_json::Value,
}

/// Verify a NEAR transaction on-chain with retries.
///
/// Uses optimistic finality ("INCLUDED") for faster response.
/// Retries up to 3 times with 1s delay if transaction is not yet available.
pub async fn verify_near_tx(
    rpc_url: &str,
    tx_hash: &str,
    expected_signer: &str,
) -> Result<VerifiedTx, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "1",
        "method": "tx",
        "params": {
            "tx_hash": tx_hash,
            "sender_account_id": expected_signer,
            "wait_until": "INCLUDED",
        }
    });

    let mut last_error = String::from("Transaction not found");

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS)).await;
        }

        let resp = match client.post(rpc_url).json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("RPC request failed: {}", e);
                continue;
            }
        };

        let json: serde_json::Value = match resp.json().await {
            Ok(j) => j,
            Err(e) => {
                last_error = format!("RPC response parse failed: {}", e);
                continue;
            }
        };

        // Check for RPC error (tx not found yet)
        if let Some(err) = json.get("error") {
            last_error = format!("RPC error: {}", err);
            continue;
        }

        let result = &json["result"];

        // Check transaction status — must be successful
        let status = &result["status"];
        if status.get("Failure").is_some() {
            return Err(format!("Transaction failed on-chain: {}", status));
        }
        if status.get("SuccessValue").is_none() && status.get("SuccessReceiptId").is_none() {
            last_error = format!("Unknown transaction status: {}", status);
            continue;
        }

        // Extract transaction details
        let tx = &result["transaction"];
        let signer_id = tx["signer_id"]
            .as_str()
            .ok_or("Missing signer_id in transaction")?
            .to_string();
        let receiver_id = tx["receiver_id"]
            .as_str()
            .ok_or("Missing receiver_id in transaction")?
            .to_string();

        // Verify signer matches
        if signer_id != expected_signer {
            return Err(format!(
                "Signer mismatch: expected {}, got {}",
                expected_signer, signer_id
            ));
        }

        // Extract first FunctionCall action
        let actions = tx["actions"]
            .as_array()
            .ok_or("Missing actions in transaction")?;

        let func_call = actions
            .iter()
            .find_map(|a| a.get("FunctionCall"))
            .ok_or("No FunctionCall action in transaction")?;

        let method_name = func_call["method_name"]
            .as_str()
            .ok_or("Missing method_name")?
            .to_string();

        let deposit = func_call["deposit"]
            .as_str()
            .unwrap_or("0")
            .to_string();

        // Decode args from base64
        let args_b64 = func_call["args"]
            .as_str()
            .unwrap_or("");
        let args_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            args_b64,
        )
        .unwrap_or_default();
        let args_json: serde_json::Value = serde_json::from_slice(&args_bytes)
            .unwrap_or(serde_json::Value::Null);

        return Ok(VerifiedTx {
            signer_id,
            receiver_id,
            method_name,
            deposit,
            args_json,
        });
    }

    Err(last_error)
}
