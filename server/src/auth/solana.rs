use ed25519_dalek::{Signature, Verifier, VerifyingKey, PUBLIC_KEY_LENGTH, SIGNATURE_LENGTH};

/// Verify a Solana `signMessage` signature.
///
/// Solana wallets (Phantom, Solflare, Backpack) sign raw UTF-8 bytes with
/// standard Ed25519 — no Borsh wrapping or hashing like NEP-413.
/// The public key IS the Solana address (base58-encoded 32-byte Ed25519 key).
pub fn verify_solana_signature(
    solana_address: &str,
    signature_b58: &str,
    message: &str,
) -> Result<bool, String> {
    let pk_bytes = bs58::decode(solana_address)
        .into_vec()
        .map_err(|e| format!("Invalid Solana address base58: {}", e))?;

    if pk_bytes.len() != PUBLIC_KEY_LENGTH {
        return Err(format!(
            "Invalid Solana address length: {} (expected {})",
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

    let sig_bytes = bs58::decode(signature_b58)
        .into_vec()
        .map_err(|e| format!("Invalid signature base58: {}", e))?;

    if sig_bytes.len() != SIGNATURE_LENGTH {
        return Err(format!(
            "Invalid signature length: {} (expected {})",
            sig_bytes.len(),
            SIGNATURE_LENGTH
        ));
    }

    let signature = Signature::from_bytes(
        sig_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid signature length".to_string())?,
    );

    // Solana signMessage signs raw UTF-8 bytes directly
    match verifying_key.verify(message.as_bytes(), &signature) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}
