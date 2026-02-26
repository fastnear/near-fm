use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i32,
    pub account_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub reputation_score: f64,
    pub total_uploads: i32,
    pub total_tips_received_yocto: String,
    pub is_admin: bool,
    pub is_banned: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
    pub is_validated: bool,
    pub is_hidden: bool,
    pub is_deleted: bool,
    pub fulfills_request_id: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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
    pub is_validated: bool,
    pub is_hidden: bool,
    pub is_deleted: bool,
    pub fulfills_request_id: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub uploader_account_id: String,
    pub uploader_display_name: Option<String>,
    pub uploader_reputation: f64,
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
    pub bounty_tx_hash: String,
    pub status: String,
    pub awarded_song_id: Option<i32>,
    pub award_tx_hash: Option<String>,
    pub withdrawal_penalty_yocto: Option<String>,
    pub withdrawal_tx_hash: Option<String>,
    pub language_id: Option<i32>,
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
