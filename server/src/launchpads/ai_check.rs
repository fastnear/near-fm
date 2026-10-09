//! Optional AI review: is the coin actually about the song?
//!
//! Disabled unless `COIN_AI_CHECK_URL` is set; then every check is allowed.
//! A failing or unreachable reviewer never blocks a launch (fail open) — the
//! check is a quality filter for what near.fm shows, not a security boundary.

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub struct Verdict {
    /// Whether near.fm shows this coin on the song page.
    pub allowed: bool,
    /// Short explanation for the author.
    pub reason: String,
    /// `false` when the reviewer is not configured or did not answer.
    pub reviewed: bool,
}

impl Verdict {
    fn skipped(reason: &str) -> Self {
        Self { allowed: true, reason: reason.to_string(), reviewed: false }
    }
}

pub struct SongContext<'a> {
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub lyrics: Option<&'a str>,
}

pub struct CoinContext<'a> {
    pub name: &'a str,
    pub symbol: &'a str,
    pub description: Option<&'a str>,
}

pub fn enabled() -> bool {
    std::env::var("COIN_AI_CHECK_URL").map(|v| !v.is_empty()).unwrap_or(false)
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

pub fn prompt(song: &SongContext, coin: &CoinContext) -> String {
    format!(
        "You review memecoins that song authors launch from their songs on near.fm.\n\
         Decide whether the coin is plausibly derived from THIS song: its name, ticker \
         or description should reference the song's title, lyrics, characters, mood or \
         theme. Wordplay, abbreviations and slang are fine. Reject coins that are about \
         something unrelated, that impersonate a real brand, project or person not in \
         the song, or that are hateful or sexual.\n\n\
         SONG\nTitle: {title}\nDescription: {desc}\nLyrics (excerpt):\n{lyrics}\n\n\
         COIN\nName: {name}\nTicker: {symbol}\nDescription: {cdesc}\n\n\
         Answer with JSON only: {{\"allowed\": true|false, \"reason\": \"one short sentence\"}}",
        title = clip(song.title, 200),
        desc = clip(song.description.unwrap_or("-"), 500),
        lyrics = clip(song.lyrics.unwrap_or("-"), 1500),
        name = clip(coin.name, 64),
        symbol = clip(coin.symbol, 16),
        cdesc = clip(coin.description.unwrap_or("-"), 500),
    )
}

/// Pull `{"allowed":..,"reason":..}` out of a model's answer, which may wrap
/// the JSON in prose or a code fence.
pub fn parse_answer(text: &str) -> Option<Verdict> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    let v: Value = serde_json::from_str(text.get(start..=end)?).ok()?;
    Some(Verdict {
        allowed: v["allowed"].as_bool()?,
        reason: v["reason"].as_str().unwrap_or("").to_string(),
        reviewed: true,
    })
}

/// Ask the reviewer. Transport: POST `{"prompt": ...}` to `COIN_AI_CHECK_URL`
/// (optional bearer `COIN_AI_CHECK_TOKEN`); the answer text is read from
/// `response`, `text`, `result` or `content`, or the raw body.
pub async fn review(http: &reqwest::Client, song: &SongContext<'_>, coin: &CoinContext<'_>) -> Verdict {
    let Ok(url) = std::env::var("COIN_AI_CHECK_URL") else {
        return Verdict::skipped("AI review is not enabled");
    };
    if url.is_empty() {
        return Verdict::skipped("AI review is not enabled");
    }
    let mut req = http
        .post(&url)
        .timeout(std::time::Duration::from_secs(45))
        .json(&json!({ "prompt": prompt(song, coin) }));
    if let Ok(token) = std::env::var("COIN_AI_CHECK_TOKEN") {
        if !token.is_empty() {
            req = req.bearer_auth(token);
        }
    }
    let body = match req.send().await {
        Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
        Ok(r) => {
            tracing::warn!(status = %r.status(), "coin AI review failed");
            return Verdict::skipped("AI review unavailable");
        }
        Err(e) => {
            tracing::warn!("coin AI review error: {e}");
            return Verdict::skipped("AI review unavailable");
        }
    };
    let text = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            ["response", "text", "result", "content"]
                .iter()
                .find_map(|k| v[*k].as_str().map(str::to_string))
        })
        .unwrap_or(body);
    parse_answer(&text).unwrap_or_else(|| {
        tracing::warn!("coin AI review: unparseable answer");
        Verdict::skipped("AI review unavailable")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wrapped_answers() {
        let v = parse_answer("Sure:\n```json\n{\"allowed\": false, \"reason\": \"unrelated\"}\n```").unwrap();
        assert!(!v.allowed && v.reviewed);
        assert_eq!(v.reason, "unrelated");
        assert!(parse_answer("no json here").is_none());
        assert!(parse_answer("{\"reason\": \"missing allowed\"}").is_none());
    }

    #[test]
    fn prompt_carries_song_and_coin() {
        let p = prompt(
            &SongContext { title: "Doom Slug", description: None, lyrics: Some("slugs at dawn") },
            &CoinContext { name: "Doomslug", symbol: "SLUG", description: None },
        );
        assert!(p.contains("Doom Slug") && p.contains("SLUG") && p.contains("slugs at dawn"));
    }
}
