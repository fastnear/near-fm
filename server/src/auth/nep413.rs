use ed25519_dalek::{Signature, VerifyingKey, PUBLIC_KEY_LENGTH};
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

/// NEP-413 message payload for signature verification.
/// https://github.com/nicechute/NEPs/blob/master/neps/nep-0413.md
#[derive(Debug, Serialize, Deserialize)]
pub struct Nep413Payload {
    pub message: String,
    pub nonce: Vec<u8>,     // 32 bytes
    pub recipient: String,
}

/// Verify an Ed25519 signature against a NEP-413 message.
///
/// The signed data is: SHA256(borsh_serialize(tag_length + tag + payload))
/// where tag = "NEP0413" and payload is Borsh-serialized Nep413Payload.
pub fn verify_nep413_signature(
    public_key_b58: &str,
    signature_b64: &str,
    message: &str,
    nonce: &[u8],
    recipient: &str,
) -> Result<bool, String> {
    // Decode public key from base58 (strip "ed25519:" prefix if present)
    let pk_str = public_key_b58
        .strip_prefix("ed25519:")
        .unwrap_or(public_key_b58);
    let pk_bytes = bs58::decode(pk_str)
        .into_vec()
        .map_err(|e| format!("Invalid public key base58: {}", e))?;

    if pk_bytes.len() != PUBLIC_KEY_LENGTH {
        return Err(format!(
            "Invalid public key length: {} (expected {})",
            pk_bytes.len(),
            PUBLIC_KEY_LENGTH
        ));
    }

    let verifying_key = VerifyingKey::from_bytes(
        pk_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid public key bytes".to_string())?,
    )
    .map_err(|e| format!("Invalid public key: {}", e))?;

    // Decode signature from base64
    let sig_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        signature_b64,
    )
    .map_err(|e| format!("Invalid signature base64: {}", e))?;

    let signature = Signature::from_bytes(
        sig_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid signature length".to_string())?,
    );

    // Construct NEP-413 Borsh payload
    // Format: u32(tag_len) + tag_bytes + borsh(payload)
    let tag = b"NEP0413";
    let mut borsh_data: Vec<u8> = Vec::new();

    // Tag as Borsh string: u32 LE length + bytes
    borsh_data.extend_from_slice(&(tag.len() as u32).to_le_bytes());
    borsh_data.extend_from_slice(tag);

    // Payload fields as Borsh:
    // message: string (u32 len + bytes)
    let msg_bytes = message.as_bytes();
    borsh_data.extend_from_slice(&(msg_bytes.len() as u32).to_le_bytes());
    borsh_data.extend_from_slice(msg_bytes);

    // nonce: fixed 32 bytes (as byte array, Borsh u32 len + bytes)
    borsh_data.extend_from_slice(&(nonce.len() as u32).to_le_bytes());
    borsh_data.extend_from_slice(nonce);

    // recipient: string
    let recipient_bytes = recipient.as_bytes();
    borsh_data.extend_from_slice(&(recipient_bytes.len() as u32).to_le_bytes());
    borsh_data.extend_from_slice(recipient_bytes);

    // Optional callback_url: None = 0u8
    borsh_data.push(0u8);

    // Hash the serialized data
    let hash = Sha256::digest(&borsh_data);

    // Verify signature against hash
    use ed25519_dalek::Verifier;
    match verifying_key.verify(&hash, &signature) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Verify that a public key belongs to an account via NEAR RPC.
pub async fn verify_access_key(
    rpc_url: &str,
    account_id: &str,
    public_key: &str,
) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "dontcare",
        "method": "query",
        "params": {
            "request_type": "view_access_key",
            "finality": "final",
            "account_id": account_id,
            "public_key": public_key,
        }
    });

    let resp = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {}", e))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("RPC response parse failed: {}", e))?;

    // If there's no error, the key exists
    Ok(json.get("error").is_none() && json.get("result").is_some())
}
