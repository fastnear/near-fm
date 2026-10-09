//! External memecoin launchpads.
//!
//! Each launchpad lives in its own module and is the ONLY place that knows its
//! contract: account ids, method names, record shapes. When a launchpad changes
//! its contract, fix its module; nothing else in near.fm needs to change.
//!
//! The server never launches anything — the author signs the launch in their
//! own wallet. The server only finds that launch on chain, checks it belongs to
//! the song's author, and links it to the song.

pub mod ai_check;
pub mod nearly_trade;

/// A launch as read back from the chain.
#[derive(Debug, Clone)]
pub struct FoundLaunch {
    pub token_account: String,
    pub launch_id: Option<String>,
    pub creator: String,
    pub name: String,
    pub symbol: String,
    pub description: Option<String>,
    pub created_at_ms: u64,
    /// The token trades (pool open, launch finished).
    pub live: bool,
}

/// Launchpads near.fm can link. Ids are stored in `song_coins.launchpad`.
pub const SUPPORTED: &[&str] = &[nearly_trade::ID];

pub fn is_supported(id: &str) -> bool {
    SUPPORTED.contains(&id)
}

/// Find the newest launch by `creator` with `symbol`, created at or after
/// `since_ms`. `Ok(None)`: not on chain (yet).
pub async fn find_launch(
    launchpad: &str,
    rpc_url: &str,
    creator: &str,
    symbol: &str,
    since_ms: u64,
) -> Result<Option<FoundLaunch>, String> {
    match launchpad {
        nearly_trade::ID => nearly_trade::find_launch(rpc_url, creator, symbol, since_ms).await,
        other => Err(format!("unsupported launchpad '{other}'")),
    }
}

/// Re-read one linked launch (status refresh).
pub async fn get_launch(launchpad: &str, rpc_url: &str, token_account: &str) -> Result<Option<FoundLaunch>, String> {
    match launchpad {
        nearly_trade::ID => nearly_trade::get_launch_by_token(rpc_url, token_account).await,
        other => Err(format!("unsupported launchpad '{other}'")),
    }
}
