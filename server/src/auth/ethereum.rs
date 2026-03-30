use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use sha3::{Digest, Keccak256};

/// Verify an EIP-191 `personal_sign` signature.
///
/// EVM wallets (MetaMask, Rainbow, Rabby, etc.) sign messages with EIP-191:
///   hash = Keccak256("\x19Ethereum Signed Message:\n" + len(message) + message)
///   signature = secp256k1_sign(hash, private_key)
///
/// Recovery: from (hash, v, r, s) → public key → Keccak256(pubkey[1..]) → last 20 bytes = address.
pub fn verify_eth_signature(
    eth_address: &str,
    signature_hex: &str,
    message: &str,
) -> Result<bool, String> {
    // Parse address: "0x..." → 20 bytes
    let addr_hex = eth_address.strip_prefix("0x").unwrap_or(eth_address);
    if addr_hex.len() != 40 {
        return Err(format!("Invalid Ethereum address length: {}", addr_hex.len()));
    }
    let expected_addr = hex::decode(addr_hex)
        .map_err(|e| format!("Invalid address hex: {}", e))?;

    // Parse signature: "0x..." → 65 bytes (r[32] + s[32] + v[1])
    let sig_hex = signature_hex.strip_prefix("0x").unwrap_or(signature_hex);
    let sig_bytes = hex::decode(sig_hex)
        .map_err(|e| format!("Invalid signature hex: {}", e))?;
    if sig_bytes.len() != 65 {
        return Err(format!("Invalid signature length: {} (expected 65)", sig_bytes.len()));
    }

    // EIP-191 message hash
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
    let hash = Keccak256::digest(prefixed.as_bytes());

    // Split signature into r, s, v
    let r_s = &sig_bytes[..64];
    let v = sig_bytes[64];

    // Recovery ID: v can be 0, 1 or 27, 28
    let recovery_id = match v {
        0 | 1 => v,
        27 | 28 => v - 27,
        _ => return Err(format!("Invalid v value: {}", v)),
    };

    let signature = Signature::from_slice(r_s)
        .map_err(|e| format!("Invalid signature: {}", e))?;

    let recid = RecoveryId::new(recovery_id != 0, false);

    // Recover public key from signature
    let recovered_key = VerifyingKey::recover_from_prehash(&hash, &signature, recid)
        .map_err(|e| format!("Recovery failed: {}", e))?;

    // Public key → address: Keccak256(uncompressed_pubkey[1..]) → last 20 bytes
    let pubkey_bytes = recovered_key
        .to_encoded_point(false);
    let pubkey_uncompressed = pubkey_bytes.as_bytes();
    // Skip the 0x04 prefix byte
    let addr_hash = Keccak256::digest(&pubkey_uncompressed[1..]);
    let recovered_addr = &addr_hash[12..]; // last 20 bytes

    Ok(recovered_addr == expected_addr.as_slice())
}
