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
/// model `COIN_AI_CHECK_MODEL` (default `claude-haiku-4-5-20251001`, the
/// cheapest). The answer is `choices[0].message.content`.
async fn chat(http: &reqwest::Client, user_prompt: &str, temperature: f32) -> Result<String, String> {
    let base = std::env::var("COIN_AI_CHECK_URL").unwrap_or_default();
    if base.is_empty() {
        return Err("not enabled".to_string());
    }
    let model = std::env::var("COIN_AI_CHECK_MODEL")
        .ok()
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "claude-haiku-4-5-20251001".to_string());
    let mut req = http
        .post(format!("{}/chat/completions", base.trim_end_matches('/')))
        // The route answering the author sits behind nginx's 60 s cut.
        .timeout(std::time::Duration::from_secs(50))
        .json(&json!({
            "model": model,
            "temperature": temperature,
            "messages": [{ "role": "user", "content": user_prompt }],
        }));
    if let Ok(token) = std::env::var("COIN_AI_CHECK_TOKEN") {
        if !token.is_empty() {
            req = req.bearer_auth(token);
        }
    }
    let resp = req.send().await.map_err(|e| format!("request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("status {}", resp.status()));
    }
    let body = resp.text().await.unwrap_or_default();
    Ok(serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v["choices"][0]["message"]["content"].as_str().map(str::to_string))
        .unwrap_or(body))
}

pub async fn review(http: &reqwest::Client, song: &SongContext<'_>, coin: &CoinContext<'_>) -> Verdict {
    if !enabled() {
        return Verdict::skipped("AI review is not enabled");
    }
    let text = match chat(http, &prompt(song, coin), 0.0).await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("coin AI review: {e}");
            return Verdict::skipped("AI review unavailable");
        }
    };
    parse_answer(&text).unwrap_or_else(|| {
        tracing::warn!("coin AI review: unparseable answer: {}", text.chars().take(200).collect::<String>());
        Verdict::skipped("AI review unavailable")
    })
}

/// A proposed coin for a song: name, ticker and description to prefill the
/// launch form. The author can edit everything before launching.
#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    pub name: String,
    pub symbol: String,
    pub description: String,
}

pub fn suggest_prompt(song: &SongContext) -> String {
    format!(
        "You name memecoins that song authors launch from their songs on near.fm, a music platform on NEAR.\n\
         Propose one coin for THIS song:\n\
         - name: catchy, 2 to 32 characters, drawn from the song's title, hook, a character, image or mood. \
           Not just the title verbatim if something better is in the lyrics. Natural capitalization \
           (\"Gonna Make It\", not \"GONNA MAKE IT\"), and different from the symbol.\n\
         - symbol: 2 to 12 uppercase letters or digits, memorable, no spaces, no $.\n\
         - description: 1 to 2 playful sentences, at most 280 characters, that tell what the coin is about and \
           name the song. No price talk, no promises, no \"official\", no real brands, companies or people \
           unless they are in the song.\n\n\
         SONG\nTitle: {title}\nDescription: {desc}\nLyrics (excerpt):\n{lyrics}\n\n\
         Answer with JSON only: {{\"name\": \"...\", \"symbol\": \"...\", \"description\": \"...\"}}",
        title = clip(song.title, 200),
        desc = clip(song.description.unwrap_or("-"), 500),
        lyrics = clip(song.lyrics.unwrap_or("-"), 1500),
    )
}

pub fn parse_suggestion(text: &str) -> Option<Suggestion> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    let v: Value = serde_json::from_str(text.get(start..=end)?).ok()?;
    let name: String = v["name"].as_str()?.trim().chars().take(32).collect();
    let symbol: String = v["symbol"].as_str()?.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).take(12).collect();
    let description: String = v["description"].as_str().unwrap_or("").trim().chars().take(300).collect();
    if name.len() < 2 || symbol.len() < 2 {
        return None;
    }
    Some(Suggestion { name, symbol, description })
}

pub async fn suggest(http: &reqwest::Client, song: &SongContext<'_>) -> Result<Suggestion, String> {
    if !enabled() {
        return Err("AI suggestions are not enabled".to_string());
    }
    let text = chat(http, &suggest_prompt(song), 0.8).await.map_err(|e| {
        tracing::warn!("coin AI suggest: {e}");
        "AI is unavailable right now".to_string()
    })?;
    parse_suggestion(&text).ok_or_else(|| {
        tracing::warn!("coin AI suggest: unparseable answer: {}", text.chars().take(200).collect::<String>());
        "AI gave an unusable answer, try again".to_string()
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
    fn parses_suggestions_and_normalizes_symbol() {
        let s = parse_suggestion("```json\n{\"name\": \" Doomslug \", \"symbol\": \"$slug-9!\", \"description\": \"A slug.\"}\n```").unwrap();
        assert_eq!(s.name, "Doomslug");
        assert_eq!(s.symbol, "SLUG9");
        assert!(parse_suggestion("{\"name\": \"X\", \"symbol\": \"ABC\"}").is_none(), "1-char name refused");
        assert!(parse_suggestion("{\"name\": \"Fine\", \"symbol\": \"$\"}").is_none(), "empty symbol refused");
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
        let sug = suggest(&http, &song).await.expect("suggestion");
        eprintln!("suggestion: {sug:?}");
        assert!(sug.name.len() >= 2 && sug.symbol.len() >= 2 && !sug.description.is_empty());
        // The suggestion must itself pass the relevance review.
        let v = review(&http, &song, &CoinContext { name: &sug.name, symbol: &sug.symbol, description: Some(&sug.description) }).await;
        assert!(v.allowed, "suggested coin failed review: {}", v.reason);
    }
}
