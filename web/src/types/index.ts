export interface User {
  id: number;
  account_id: string;
  display_name: string | null;
  avatar_url: string | null;
  reputation_score: string;
  total_uploads: number;
  total_tips_received_yocto: string;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
}

export interface Song {
  id: number;
  uuid: string;
  uploader_id: number;
  title: string;
  description: string | null;
  lyrics: string | null;
  ai_model: string | null;
  audio_url: string;
  audio_hash: string;
  audio_duration_seconds: number | null;
  audio_mime_type: string;
  cover_image_url: string | null;
  category_id: number | null;
  language_id: number | null;
  score: string;
  upvotes: number;
  downvotes: number;
  play_count: number;
  total_tips_yocto: string;
  is_validated: boolean;
  is_hidden: boolean;
  is_deleted: boolean;
  fulfills_request_id: number | null;
  diamond_like_count: number;
  created_on_nearfm: boolean;
  created_at: string;
  updated_at: string;
  // Uploader join fields
  uploader_account_id: string;
  uploader_near_account_id: string | null;
  uploader_display_name: string | null;
  uploader_reputation: string;
  uploader_twitter_handle: string | null;
  uploader_is_agent: boolean;
  // Category join fields
  category_name: string | null;
  category_slug: string | null;
  // Comment count
  comment_count: number;
  // Genres
  genres: Genre[];
  // Language join fields
  language_code: string | null;
  language_name: string | null;
  // Bounty request join fields
  fulfills_request_uuid: string | null;
  fulfills_request_title: string | null;
}

export interface Genre {
  id: number;
  name: string;
  slug: string;
  display_order: number;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
}

export interface Language {
  id: number;
  code: string;
  name: string;
}

export interface SongRequest {
  id: number;
  uuid: string;
  requester_id: number;
  title: string;
  description: string;
  bounty_amount_yocto: string;
  bounty_tx_hash: string;
  status: string;
  awarded_song_id: number | null;
  award_tx_hash: string | null;
  language_id: number | null;
  expires_at: string | null;
  created_at: string;
}

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface FeedPreferences {
  excluded_genres: number[];
  excluded_languages: number[];
  excluded_categories: number[];
}

export interface Playlist {
  id: number;
  uuid: string;
  user_id: number;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  feed_token: string;
  is_auto: boolean;
  song_count: number;
  created_at: string;
  updated_at: string;
  contains_song?: boolean;
}

export type SortMode = "trending" | "latest" | "top" | "community" | "following";
export type TimePeriod = "day" | "week" | "month" | "all";
