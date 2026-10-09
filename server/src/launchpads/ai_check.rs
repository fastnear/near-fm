//! Optional AI review: is the coin actually about the song?
//!
//! Disabled unless `COIN_AI_CHECK_URL` is set (then every check is allowed).
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

/// Ask the reviewer: an OpenAI-compatible chat endpoint at `COIN_AI_CHECK_URL`
/// (base URL, e.g. `http://172.17.0.1:18317/v1`), bearer `COIN_AI_CHECK_TOKEN`,
/// model `COIN_AI_CHECK_MODEL` (default `claude-sonnet-4-6`). The answer is
/// `choices[0].message.content`.
pub async fn review(http: &reqwest::Client, song: &SongContext<'_>, coin: &CoinContext<'_>) -> Verdict {
    let base = std::env::var("COIN_AI_CHECK_URL").unwrap_or_default();
    if base.is_empty() {
        return Verdict::skipped("AI review is not enabled");
    }
    let model = std::env::var("COIN_AI_CHECK_MODEL").ok().filter(|m| !m.is_empty()).unwrap_or_else(|| "claude-sonnet-4-6".to_string());
    let mut req = http
        .post(format!("{}/chat/completions", base.trim_end_matches('/')))
        // The route answering the author sits behind nginx's 60 s cut.
        .timeout(std::time::Duration::from_secs(50))
        .json(&json!({
            "model": model,
            "temperature": 0,
            "messages": [{ "role": "user", "content": prompt(song, coin) }],
        }));
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
        .and_then(|v| v["choices"][0]["message"]["content"].as_str().map(str::to_string))
        .unwrap_or(body);
    parse_answer(&text).unwrap_or_else(|| {
        tracing::warn!("coin AI review: unparseable answer: {}", text.chars().take(200).collect::<String>());
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

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Talks to the local reviewer. Run by hand with the env set:
    /// COIN_AI_CHECK_URL=http://127.0.0.1:18317/v1 COIN_AI_CHECK_TOKEN=... cargo test --release -- --ignored ai_live
    #[tokio::test]
    #[ignore]
    async fn ai_live_related_vs_unrelated() {
        assert!(enabled(), "set COIN_AI_CHECK_URL");
        let http = reqwest::Client::new();
        let song = SongContext {
            title: "We're All Gonna Make It Now",
            description: Some("Euphoric anthemic pop about everyone, humans and AI agents, winning together"),
            lyrics: Some("everything's green, everything's up\nraise it high, baby, fill the cup\nwe're all gonna make it now\n(we're all gonna be rich)"),
        };
        let related = review(&http, &song, &CoinContext { name: "Gonna Make It", symbol: "WAGMI", description: Some("Memecoin of the song on near.fm") }).await;
        assert!(related.reviewed, "{related:?}");
        assert!(related.allowed, "related coin refused: {}", related.reason);
        let unrelated = review(&http, &song, &CoinContext { name: "Elon Tesla Official", symbol: "TSLA", description: Some("The official Tesla token") }).await;
        assert!(unrelated.reviewed, "{unrelated:?}");
        assert!(!unrelated.allowed, "unrelated/impersonating coin allowed: {}", unrelated.reason);
    }
}
