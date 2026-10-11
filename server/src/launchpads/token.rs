//! Looking up an existing NEP-141 token that an author wants to attach to a
//! song: is it a token at all, what is it called, where did it come from, and
//! where can it be traded.

use serde::Serialize;
use serde_json::json;

#[derive(Debug, Clone, Serialize)]
pub struct TokenInfo {
    pub token_account: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub decimals: u32,
    pub total_supply: Option<String>,
    /// `nearly.trade` | `justhoot.fun` | `external`
    pub source: String,
    pub creator: Option<String>,
    /// Default trading link: the launchpad's token page when we know it,
    /// else the Rhea swap page. The author can replace it.
    pub trade_url: Option<String>,
}

/// Sites a trade link may point at without a "leaving near.fm" warning.
pub const TRUSTED_HOSTS: &[&str] = &[
    "nearly.trade",
    "justhoot.fun",
    "dexscreener.com",
    "nearblocks.io",
    "dex.rhea.finance",
    "app.ref.finance",
    "near.fm",
];

pub fn is_valid_account_id(s: &str) -> bool {
    (2..=64).contains(&s.len())
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_' || b == b'-')
        && !s.starts_with('.')
        && !s.ends_with('.')
        && !s.contains("..")
}

/// Accepts a bare account id or a nearly.trade / nearblocks / dexscreener URL that contains one.
pub fn extract_account_id(input: &str) -> Option<String> {
    let s = input.trim().trim_end_matches('/');
    if is_valid_account_id(s) {
        return Some(s.to_string());
    }
    let path = s.split("://").nth(1).unwrap_or(s);
    // Skip the host; the first path segment that is a dotted account id wins.
    // DexScreener pair ids look like `refv2-<token>:<quote>:<fee>`.
    for seg in path.split('/').skip(1) {
        let seg = seg.split(['?', '#']).next().unwrap_or("");
        let cand = seg.trim_start_matches("refv2-").split(':').next().unwrap_or("");
        if is_valid_account_id(cand) && cand.contains('.') {
            return Some(cand.to_string());
        }
    }
    None
}

/// Validate an author-supplied trade link: https, and whether its host is known.
pub fn check_trade_url(url: &str) -> Result<(String, bool), String> {
    let u = url.trim();
    if u.len() > 300 || !u.starts_with("https://") {
        return Err("Trade link must be an https:// URL".to_string());
    }
    let host = u["https://".len()..].split(['/', '?', '#']).next().unwrap_or("").to_lowercase();
    if host.is_empty() || host.contains('@') {
        return Err("Trade link must be an https:// URL".to_string());
    }
    let trusted = TRUSTED_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")));
    Ok((u.to_string(), trusted))
}

/// Rhea (ex-Ref) swap page for any NEAR token — the default "Trade" link
/// for tokens that did not come from a launchpad we know.
pub fn rhea_swap_url(token_account: &str) -> String {
    format!("https://dex.rhea.finance/#near|{token_account}")
}

pub async fn lookup(_http: &reqwest::Client, rpc_url: &str, token_account: &str) -> Result<TokenInfo, String> {
    if !is_valid_account_id(token_account) {
        return Err("That is not a valid NEAR account id".to_string());
    }
    let meta = crate::near::rpc::view_call(rpc_url, token_account, "ft_metadata", &json!({}))
        .await
        .map_err(|_| "No token found at that account (it does not answer ft_metadata)".to_string())?;
    let symbol = meta["symbol"].as_str().unwrap_or("").trim().to_string();
    let name = meta["name"].as_str().unwrap_or("").trim().to_string();
    if symbol.is_empty() {
        return Err("The token has no symbol in its metadata".to_string());
    }
    let icon = meta["icon"].as_str().filter(|s| !s.is_empty()).map(|s| s.chars().take(20_000).collect());
    let decimals = meta["decimals"].as_u64().unwrap_or(0) as u32;
    let total_supply = crate::near::rpc::view_call(rpc_url, token_account, "ft_total_supply", &json!({}))
        .await
        .ok()
        .and_then(|v| v.as_str().map(str::to_string));

    let (source, creator, trade_url) = if token_account.ends_with(".nearlytrade.near") {
        let creator = super::nearly_trade::get_launch_by_token(rpc_url, token_account)
            .await
            .ok()
            .flatten()
            .map(|l| l.creator);
        ("nearly.trade".to_string(), creator, Some(format!("https://nearly.trade/{token_account}")))
    } else {
        let source = if token_account.ends_with(".launchpad.justhoot.near") { "justhoot.fun" } else { "external" };
        (source.to_string(), None, Some(rhea_swap_url(token_account)))
    };

    Ok(TokenInfo {
        token_account: token_account.to_string(),
        name: if name.is_empty() { symbol.clone() } else { name },
        symbol,
        icon,
        decimals,
        total_supply,
        source,
        creator,
        trade_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_ids_and_urls() {
        assert!(is_valid_account_id("sherifchenko.nearlytrade.near"));
        assert!(!is_valid_account_id("Bad.Case") && !is_valid_account_id("a..b") && !is_valid_account_id("x"));
        assert_eq!(extract_account_id("https://nearly.trade/sherifchenko.nearlytrade.near").as_deref(), Some("sherifchenko.nearlytrade.near"));
        assert_eq!(extract_account_id("https://nearblocks.io/token/token.rhealab.near?tab=x").as_deref(), Some("token.rhealab.near"));
        assert_eq!(extract_account_id("https://dexscreener.com/near/refv2-sherifchenko.nearlytrade.near:wrap.near:10000").as_deref(), Some("sherifchenko.nearlytrade.near"));
        assert_eq!(extract_account_id(" token.rhealab.near "), Some("token.rhealab.near".to_string()));
        assert_eq!(extract_account_id("https://nearly.trade/"), None);
    }

    #[test]
    fn trade_url_trust() {
        assert_eq!(check_trade_url("https://nearly.trade/x.nearlytrade.near").unwrap().1, true);
        assert_eq!(check_trade_url("https://dexscreener.com/near/abc").unwrap().1, true);
        assert_eq!(check_trade_url("https://evil-dexscreener.com/near/abc").unwrap().1, false);
        assert_eq!(check_trade_url("https://some-site.xyz/token").unwrap().1, false);
        assert!(check_trade_url("http://nearly.trade/x").is_err());
        assert!(check_trade_url("javascript:alert(1)").is_err());
    }
}
