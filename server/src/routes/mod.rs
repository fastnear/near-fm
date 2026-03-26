pub fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        s.chars().take(max_len).collect()
    }
}

pub mod admin;
pub mod blog;
pub mod fastfs;
pub mod auth;
pub mod comments;
pub mod credits;
pub mod playlists;
pub mod premium;
pub mod reports;
pub mod requests;
pub mod rss;
pub mod songs;
pub mod suno;
pub mod tips;
pub mod users;
