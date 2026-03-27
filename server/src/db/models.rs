use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use sqlx::postgres::PgRow;
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i32,
    pub account_id: Option<String>,
    pub slug: String,
    pub google_id: Option<String>,
    pub email: Option<String>,
    pub auth_provider: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub reputation_score: f64,
    pub total_uploads: i32,
    pub total_tips_received_yocto: String,
    pub is_admin: bool,
    pub is_agent: bool,
    pub is_banned: bool,
    pub bio: Option<String>,
    pub twitter_handle: Option<String>,
    pub premium_since: Option<DateTime<Utc>>,
    pub premium_until: Option<DateTime<Utc>>,
    pub credit_balance: i32,
    pub daily_credits_used: i32,
    pub daily_credits_date: chrono::NaiveDate,
    pub solana_address: Option<String>,
    pub outlayer_api_key: Option<String>,
    pub outlayer_near_account: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Playlist {
    pub id: i32,
    pub uuid: String,
    pub user_id: i32,
    pub name: String,
    pub description: Option<String>,
    pub cover_image_url: Option<String>,
    pub feed_token: String,
    pub is_auto: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistWithCount {
    pub id: i32,
    pub uuid: String,
    pub user_id: i32,
    pub name: String,
    pub description: Option<String>,
    pub cover_image_url: Option<String>,
    pub feed_token: String,
    pub is_auto: bool,
    pub song_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl<'r> sqlx::FromRow<'r, PgRow> for PlaylistWithCount {
    fn from_row(row: &'r PgRow) -> Result<Self, sqlx::Error> {
        Ok(PlaylistWithCount {
            id: row.try_get("id")?,
            uuid: row.try_get("uuid")?,
            user_id: row.try_get("user_id")?,
            name: row.try_get("name")?,
            description: row.try_get("description")?,
            cover_image_url: row.try_get("cover_image_url")?,
            feed_token: row.try_get("feed_token")?,
            is_auto: row.try_get("is_auto")?,
            song_count: row.try_get("song_count")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Song {
    pub id: i32,
    pub uuid: String,
    pub uploader_id: i32,
    pub title: String,
    pub description: Option<String>,
    pub lyrics: Option<String>,
    pub ai_model: Option<String>,
    pub audio_url: String,
    pub audio_hash: String,
    pub audio_duration_seconds: Option<i32>,
    pub audio_mime_type: String,
    pub cover_image_url: Option<String>,
    pub category_id: Option<i32>,
    pub language_id: Option<i32>,
    pub score: f64,
    pub upvotes: i32,
    pub downvotes: i32,
    pub play_count: i32,
    pub total_tips_yocto: String,
    pub total_tips_usd_cents: i32,
    pub is_validated: bool,
    pub is_hidden: bool,
    pub is_deleted: bool,
    pub fulfills_request_id: Option<i32>,
    pub diamond_like_count: i32,
    pub created_on_nearfm: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Genre {
    pub id: i32,
    pub name: String,
    pub slug: String,
    pub display_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongWithUploader {
    pub id: i32,
    pub uuid: String,
    pub uploader_id: i32,
    pub title: String,
    pub description: Option<String>,
    pub lyrics: Option<String>,
    pub ai_model: Option<String>,
    pub audio_url: String,
    pub audio_hash: String,
    pub audio_duration_seconds: Option<i32>,
    pub audio_mime_type: String,
    pub cover_image_url: Option<String>,
    pub category_id: Option<i32>,
    pub language_id: Option<i32>,
    pub score: f64,
    pub upvotes: i32,
    pub downvotes: i32,
    pub play_count: i32,
    pub total_tips_yocto: String,
    pub total_tips_usd_cents: i32,
    pub is_validated: bool,
    pub is_hidden: bool,
    pub is_deleted: bool,
    pub fulfills_request_id: Option<i32>,
    pub diamond_like_count: i32,
    pub created_on_nearfm: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub uploader_account_id: String,
    pub uploader_near_account_id: Option<String>,
    pub uploader_display_name: Option<String>,
    pub uploader_reputation: f64,
    pub uploader_twitter_handle: Option<String>,
    pub uploader_is_agent: bool,
    pub category_name: Option<String>,
    pub category_slug: Option<String>,
    pub comment_count: i64,
    pub genres: Vec<Genre>,
    pub language_code: Option<String>,
    pub language_name: Option<String>,
    pub fulfills_request_uuid: Option<String>,
    pub fulfills_request_title: Option<String>,
}

impl<'r> sqlx::FromRow<'r, PgRow> for SongWithUploader {
    fn from_row(row: &'r PgRow) -> Result<Self, sqlx::Error> {
        let genres_json: Option<String> = row.try_get("genres_json").unwrap_or(None);
        let genres: Vec<Genre> = genres_json
            .and_then(|j| serde_json::from_str(&j).ok())
            .unwrap_or_default();

        Ok(SongWithUploader {
            id: row.try_get("id")?,
            uuid: row.try_get("uuid")?,
            uploader_id: row.try_get("uploader_id")?,
            title: row.try_get("title")?,
            description: row.try_get("description")?,
            lyrics: row.try_get("lyrics")?,
            ai_model: row.try_get("ai_model")?,
            audio_url: row.try_get("audio_url")?,
            audio_hash: row.try_get("audio_hash")?,
            audio_duration_seconds: row.try_get("audio_duration_seconds")?,
            audio_mime_type: row.try_get("audio_mime_type")?,
            cover_image_url: row.try_get("cover_image_url")?,
            category_id: row.try_get("category_id")?,
            language_id: row.try_get("language_id")?,
            score: row.try_get("score")?,
            upvotes: row.try_get("upvotes")?,
            downvotes: row.try_get("downvotes")?,
            play_count: row.try_get("play_count")?,
            total_tips_yocto: row.try_get("total_tips_yocto")?,
            total_tips_usd_cents: row.try_get("total_tips_usd_cents").unwrap_or(0),
            is_validated: row.try_get("is_validated")?,
            is_hidden: row.try_get("is_hidden")?,
            is_deleted: row.try_get("is_deleted")?,
            fulfills_request_id: row.try_get("fulfills_request_id")?,
            diamond_like_count: row.try_get("diamond_like_count")?,
            created_on_nearfm: row.try_get("created_on_nearfm").unwrap_or(false),
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            uploader_account_id: row.try_get("uploader_account_id")?,
            uploader_near_account_id: row.try_get("uploader_near_account_id").unwrap_or(None),
            uploader_display_name: row.try_get("uploader_display_name")?,
            uploader_reputation: row.try_get("uploader_reputation")?,
            uploader_twitter_handle: row.try_get("uploader_twitter_handle").unwrap_or(None),
            uploader_is_agent: row.try_get("uploader_is_agent").unwrap_or(false),
            category_name: row.try_get("category_name")?,
            category_slug: row.try_get("category_slug")?,
            comment_count: row.try_get("comment_count")?,
            genres,
            language_code: row.try_get("language_code").unwrap_or(None),
            language_name: row.try_get("language_name").unwrap_or(None),
            fulfills_request_uuid: row.try_get("fulfills_request_uuid").unwrap_or(None),
            fulfills_request_title: row.try_get("fulfills_request_title").unwrap_or(None),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Vote {
    pub id: i32,
    pub song_id: i32,
    pub user_id: i32,
    pub value: i16,
    pub weight: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tip {
    pub id: i32,
    pub song_id: i32,
    pub tipper_id: i32,
    pub recipient_id: i32,
    pub amount_yocto: String,
    pub tx_hash: String,
    pub commission_yocto: String,
    pub from_balance: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Category {
    pub id: i32,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub display_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Language {
    pub id: i32,
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SongRequest {
    pub id: i32,
    pub uuid: String,
    pub requester_id: i32,
    pub title: String,
    pub description: String,
    pub bounty_amount_yocto: String,
    pub bounty_tx_hash: Option<String>,
    pub status: String,
    pub awarded_song_id: Option<i32>,
    pub award_tx_hash: Option<String>,
    pub withdrawal_penalty_yocto: Option<String>,
    pub withdrawal_tx_hash: Option<String>,
    pub language_id: Option<i32>,
    pub is_hidden: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Bookmark {
    pub id: i32,
    pub user_id: i32,
    pub song_id: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Report {
    pub id: i32,
    pub song_id: i32,
    pub reporter_id: i32,
    pub reason: String,
    pub status: String,
    pub reviewed_by: Option<i32>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Notification {
    pub id: i32,
    pub user_id: i32,
    pub r#type: String,
    pub data: serde_json::Value,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PlatformConfig {
    pub key: String,
    pub value: String,
    pub updated_at: DateTime<Utc>,
}
