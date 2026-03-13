use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

const API_KEY_CACHE_TTL_SECS: u64 = 60;

/// Cached user data resolved from an API key.
#[derive(Debug, Clone)]
pub struct CachedKeyData {
    pub user_id: i32,
    pub slug: String,
    pub is_admin: bool,
    pub account_id: Option<String>,
}

/// In-memory cache for API key hash → user data lookups.
#[derive(Clone)]
pub struct ApiKeyCache {
    entries: Arc<RwLock<HashMap<String, (CachedKeyData, Instant)>>>,
}

impl ApiKeyCache {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get(&self, key_hash: &str) -> Option<CachedKeyData> {
        let entries = self.entries.read().await;
        if let Some((data, cached_at)) = entries.get(key_hash) {
            if cached_at.elapsed().as_secs() < API_KEY_CACHE_TTL_SECS {
                return Some(data.clone());
            }
        }
        None
    }

    pub async fn set(&self, key_hash: String, data: CachedKeyData) {
        let mut entries = self.entries.write().await;
        if entries.len() > 10_000 {
            let now = Instant::now();
            entries.retain(|_, (_, cached_at)| {
                now.duration_since(*cached_at).as_secs() < API_KEY_CACHE_TTL_SECS
            });
        }
        entries.insert(key_hash, (data, Instant::now()));
    }

    pub async fn invalidate_user(&self, user_id: i32) {
        let mut entries = self.entries.write().await;
        entries.retain(|_, (data, _)| data.user_id != user_id);
    }
}

/// Generate a new API key: `nfm_` + 32 random hex bytes.
pub fn generate_api_key() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    format!("nfm_{}", hex::encode(bytes))
}

/// SHA-256 hash of an API key (for storage/lookup).
pub fn hash_api_key(key: &str) -> String {
    hex::encode(Sha256::digest(key.as_bytes()))
}
