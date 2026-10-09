//! nearly.trade — https://nearly.trade (docs: https://nearly.trade/docs).
//!
//! Factory `nearlytrade.near`. A launch record (from `get_launches` /
//! `get_launch_by_token`) carries `id`, `token`, `creator`, `name`, `symbol`,
//! `created_at_ms` and `step` (`Done` once the pool is live).

use serde_json::{json, Value};

use super::FoundLaunch;

pub const ID: &str = "nearly.trade";
pub const FACTORY: &str = "nearlytrade.near";
/// How many of the newest launches to scan for the author's one. The author
/// links right after launching, so their launch is among the newest.
const SCAN_LIMIT: u64 = 50;

fn parse_record(v: &Value) -> Option<FoundLaunch> {
    Some(FoundLaunch {
        token_account: v["token"].as_str()?.to_string(),
        launch_id: v["id"].as_u64().map(|n| n.to_string()).or_else(|| v["id"].as_str().map(str::to_string)),
        creator: v["creator"].as_str()?.to_string(),
        name: v["name"].as_str().unwrap_or_default().to_string(),
        symbol: v["symbol"].as_str().unwrap_or_default().to_string(),
        description: v["description"].as_str().map(str::to_string),
        created_at_ms: v["created_at_ms"].as_u64().unwrap_or(0),
        live: v["step"].as_str() == Some("Done"),
    })
}

pub async fn find_launch(
    rpc_url: &str,
    creator: &str,
    symbol: &str,
    since_ms: u64,
) -> Result<Option<FoundLaunch>, String> {
    let records = crate::near::rpc::view_call(
        rpc_url,
        FACTORY,
        "get_launches",
        &json!({ "from_index": 0, "limit": SCAN_LIMIT }),
    )
    .await?;
    let records = records.as_array().ok_or("get_launches: not a list")?;
    // Newest first.
    Ok(records
        .iter()
        .filter_map(parse_record)
        .find(|l| l.creator == creator && l.symbol.eq_ignore_ascii_case(symbol) && l.created_at_ms >= since_ms))
}

pub async fn get_launch_by_token(rpc_url: &str, token: &str) -> Result<Option<FoundLaunch>, String> {
    let v = crate::near::rpc::view_call(rpc_url, FACTORY, "get_launch_by_token", &json!({ "token": token })).await?;
    Ok(if v.is_null() { None } else { parse_record(&v) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_live_record() {
        let v = json!({"id": 2799, "token": "rtl.nearlytrade.near", "creator": "a.near",
                       "name": "RheaTheLion", "symbol": "RTL", "created_at_ms": 1791548316378u64, "step": "Done"});
        let l = parse_record(&v).unwrap();
        assert_eq!(l.token_account, "rtl.nearlytrade.near");
        assert_eq!(l.launch_id.as_deref(), Some("2799"));
        assert!(l.live);
        let pending = json!({"id": 1, "token": "x.nearlytrade.near", "creator": "a.near", "step": "Pool"});
        assert!(!parse_record(&pending).unwrap().live);
    }
}

#[cfg(test)]
mod live_tests {
    /// Reads mainnet. Run by hand: cargo test -- --ignored nearly_live
    #[tokio::test]
    #[ignore]
    async fn nearly_live_find_and_get() {
        let rpc = "https://rpc.mainnet.fastnear.com";
        let l = super::find_launch(rpc, "soonwheat5362.near", "rtl", 0).await.unwrap().expect("launch 2799");
        assert_eq!(l.token_account, "rtl.nearlytrade.near");
        assert!(l.live);
        assert!(super::find_launch(rpc, "soonwheat5362.near", "RTL", u64::MAX).await.unwrap().is_none(), "since filter");
        assert!(super::find_launch(rpc, "someone-else.near", "RTL", 0).await.unwrap().is_none(), "creator filter");
        let g = super::get_launch_by_token(rpc, "rtl.nearlytrade.near").await.unwrap().unwrap();
        assert_eq!(g.creator, "soonwheat5362.near");
        assert!(super::get_launch_by_token(rpc, "zz-no-such-token-nearfm.nearlytrade.near").await.unwrap().is_none());
    }
}
