use serde_json::Value;

/// Verify a NEAR transaction exists and check its status.
pub async fn verify_transaction(
    rpc_url: &str,
    tx_hash: &str,
    sender_id: &str,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "dontcare",
        "method": "tx",
        "params": [tx_hash, sender_id]
    });

    let resp = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {}", e))?;

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("RPC response parse failed: {}", e))?;

    if let Some(error) = json.get("error") {
        return Err(format!("Transaction not found: {}", error));
    }

    Ok(json["result"].clone())
}

/// Call a view method on a NEAR contract.
pub async fn view_call(
    rpc_url: &str,
    contract_id: &str,
    method_name: &str,
    args_json: &Value,
) -> Result<Value, String> {
    let args_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        serde_json::to_string(args_json).unwrap().as_bytes(),
    );

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "dontcare",
        "method": "query",
        "params": {
            "request_type": "call_function",
            "finality": "final",
            "account_id": contract_id,
            "method_name": method_name,
            "args_base64": args_b64,
        }
    });

    let resp = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {}", e))?;

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("RPC response parse failed: {}", e))?;

    if let Some(error) = json.get("error") {
        return Err(format!("View call failed: {}", error));
    }

    // Decode the result bytes
    if let Some(result) = json["result"]["result"].as_array() {
        let bytes: Vec<u8> = result.iter().filter_map(|v| v.as_u64().map(|n| n as u8)).collect();
        let result_str = String::from_utf8(bytes).map_err(|e| format!("UTF8 decode: {}", e))?;
        serde_json::from_str(&result_str).map_err(|e| format!("JSON parse: {}", e))
    } else {
        Err("No result in response".to_string())
    }
}
