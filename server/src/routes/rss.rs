use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
};

use crate::AppState;

/// GET /feed/:feed_token — private RSS feed for podcast apps (token-based auth)
pub async fn playlist_feed(
    State(state): State<AppState>,
    Path(feed_token): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Fetch playlist by feed_token
    let playlist = sqlx::query_as::<_, crate::db::models::Playlist>(
        "SELECT * FROM playlists WHERE feed_token = $1",
    )
    .bind(&feed_token)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Feed not found".to_string()))?;

    // Verify owner is still premium
    let owner = sqlx::query_as::<_, crate::db::models::User>(
        "SELECT * FROM users WHERE id = $1",
    )
    .bind(playlist.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let is_premium = owner.premium_until.map_or(false, |u| u > chrono::Utc::now());
    if !is_premium {
        return Err((StatusCode::FORBIDDEN, "Premium subscription expired".to_string()));
    }

    // Fetch songs — auto playlist returns ALL user's songs, regular playlist returns playlist_songs
    let songs = if playlist.is_auto {
        sqlx::query_as::<_, crate::db::models::Song>(
            r#"SELECT * FROM songs
               WHERE uploader_id = $1 AND NOT is_deleted AND NOT is_hidden AND is_validated
               ORDER BY created_at DESC"#,
        )
        .bind(playlist.user_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        sqlx::query_as::<_, crate::db::models::Song>(
            r#"SELECT s.* FROM playlist_songs ps
               JOIN songs s ON ps.song_id = s.id
               WHERE ps.playlist_id = $1 AND NOT s.is_deleted AND NOT s.is_hidden
               ORDER BY ps.position, ps.added_at"#,
        )
        .bind(playlist.id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    // Determine feed image
    let feed_image = playlist.cover_image_url
        .or_else(|| songs.first().and_then(|s| s.cover_image_url.clone()))
        .or_else(|| owner.avatar_url.clone())
        .unwrap_or_else(|| "https://near.fm/logo.png".to_string());

    let author = owner.display_name.as_deref()
        .unwrap_or(owner.slug.as_str());

    let feed_link = format!("https://api.near.fm/feed/{}", feed_token);
    let description = playlist.description.as_deref().unwrap_or("A playlist on near.fm");
    let last_build = playlist.updated_at.to_rfc2822();

    // Build RSS XML
    let mut xml = String::with_capacity(4096);
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    xml.push('\n');
    xml.push_str(r#"<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">"#);
    xml.push_str("\n<channel>\n");
    xml.push_str(&format!("  <title>{}</title>\n", escape_xml(&playlist.name)));
    xml.push_str(&format!("  <link>{}</link>\n", escape_xml(&feed_link)));
    xml.push_str(&format!("  <description>{}</description>\n", escape_xml(description)));
    xml.push_str(&format!("  <lastBuildDate>{}</lastBuildDate>\n", escape_xml(&last_build)));
    xml.push_str(&format!("  <itunes:author>{}</itunes:author>\n", escape_xml(author)));
    xml.push_str(&format!("  <itunes:image href=\"{}\" />\n", escape_xml(&feed_image)));
    xml.push_str("  <itunes:category text=\"Music\" />\n");
    xml.push_str("  <itunes:explicit>false</itunes:explicit>\n");
    xml.push_str(&format!("  <image>\n    <url>{}</url>\n    <title>{}</title>\n    <link>{}</link>\n  </image>\n",
        escape_xml(&feed_image), escape_xml(&playlist.name), escape_xml(&feed_link)));

    for song in &songs {
        let pub_date = song.created_at.to_rfc2822();
        let duration = song.audio_duration_seconds
            .map(format_duration)
            .unwrap_or_default();
        let song_image = song.cover_image_url.as_deref().unwrap_or(&feed_image);

        xml.push_str("  <item>\n");
        xml.push_str(&format!("    <title>{}</title>\n", escape_xml(&song.title)));
        xml.push_str(&format!("    <guid isPermaLink=\"false\">{}</guid>\n", escape_xml(&song.uuid)));
        xml.push_str(&format!("    <pubDate>{}</pubDate>\n", escape_xml(&pub_date)));
        if let Some(desc) = &song.description {
            xml.push_str(&format!("    <description>{}</description>\n", escape_xml(desc)));
        }
        xml.push_str(&format!(
            "    <enclosure url=\"{}\" type=\"{}\" length=\"0\" />\n",
            escape_xml(&song.audio_url),
            escape_xml(&song.audio_mime_type)
        ));
        if !duration.is_empty() {
            xml.push_str(&format!("    <itunes:duration>{}</itunes:duration>\n", duration));
        }
        xml.push_str(&format!("    <itunes:image href=\"{}\" />\n", escape_xml(song_image)));
        xml.push_str(&format!("    <itunes:author>{}</itunes:author>\n", escape_xml(author)));
        xml.push_str("  </item>\n");
    }

    xml.push_str("</channel>\n</rss>\n");

    Ok((
        [
            (header::CONTENT_TYPE, "application/rss+xml; charset=utf-8"),
            (header::CACHE_CONTROL, "private, max-age=300"),
        ],
        xml,
    ))
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn format_duration(seconds: i32) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, s)
    } else {
        format!("{:02}:{:02}", m, s)
    }
}
