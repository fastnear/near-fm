import type { Song, Genre, Category, Language, SongRequest, Notification, Playlist } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 401) {
      // Session expired — notify UI to prompt re-sign-in
      window.dispatchEvent(new Event("nearfm_token_expired"));
    }
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text);
}

// ── Auth ──

export interface AuthUser {
  id: number;
  slug: string;
  account_id: string; // slug for backward compat
  near_account_id: string | null;
  solana_address: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  is_banned: boolean;
  is_premium: boolean;
  premium_until: string | null;
  auth_provider: string;
  reputation_score: string;
  credit_balance: number;
  daily_credits_remaining: number;
}

export async function verifyAuth(payload: {
  account_id: string;
  public_key: string;
  signature: string;
  message: string;
  nonce: number[];
  recipient: string;
}): Promise<{
  token: string;
  user: AuthUser;
}> {
  return fetchApi("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getCurrentUser(): Promise<AuthUser> {
  return fetchApi("/api/auth/me");
}

export async function linkWallet(payload: {
  account_id: string;
  public_key: string;
  signature: string;
  message: string;
  nonce: number[];
  recipient: string;
}): Promise<{
  token: string;
  user: AuthUser;
}> {
  return fetchApi("/api/auth/link-wallet", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Songs ──

export async function getSongs(params?: {
  sort?: string;
  period?: string;
  lang?: number;
  category?: number;
  q?: string;
  audio_hash?: string;
  genre?: string;
  lang_code?: string;
  page?: number;
  limit?: number;
}): Promise<{ songs: Song[]; page: number; limit: number }> {
  const search = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) search.set(k, String(v));
    });
  }
  return fetchApi(`/api/songs?${search.toString()}`);
}

export async function getSong(uuid: string): Promise<{ song: Song }> {
  return fetchApi(`/api/songs/${uuid}`);
}

export async function updateSong(uuid: string, data: {
  title?: string;
  description?: string;
  lyrics?: string;
  ai_model?: string;
  cover_image_url?: string;
  language_id?: number;
  category_id?: number;
  genre_ids?: number[];
  remove_cover?: boolean;
}): Promise<{ song: Song }> {
  return fetchApi(`/api/songs/${uuid}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function createSong(data: {
  title: string;
  description?: string;
  lyrics?: string;
  ai_model?: string;
  audio_url: string;
  audio_hash: string;
  audio_duration_seconds?: number;
  audio_mime_type?: string;
  cover_image_url?: string;
  language_id?: number;
  category_id?: number;
  fulfills_request_id?: number;
  genre_ids?: number[];
  suno_task_id?: string;
}): Promise<Song> {
  return fetchApi("/api/songs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface VoteData {
  upvotes: number;
  downvotes: number;
  user_vote: number;
  diamond_like_count: number;
  user_has_diamond_liked: boolean;
}

export async function getUserVote(uuid: string): Promise<VoteData> {
  return fetchApi(`/api/songs/${uuid}/vote`);
}

export async function voteSong(
  uuid: string,
  value: 1 | -1 | 0
): Promise<VoteData> {
  return fetchApi(`/api/songs/${uuid}/vote`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export async function incrementPlay(
  uuid: string
): Promise<{ play_count: number }> {
  return fetchApi(`/api/songs/${uuid}/play`, { method: "POST" });
}

export async function diamondLikeSong(uuid: string): Promise<{
  diamond_like_count: number;
  user_has_diamond_liked: boolean;
  diamond_likes_remaining_today: number;
}> {
  return fetchApi(`/api/songs/${uuid}/diamond-like`, { method: "POST" });
}

export async function getDiamondLikers(uuid: string): Promise<{
  account_id: string;
  display_name: string | null;
  avatar_url: string | null;
}[]> {
  return fetchApi(`/api/songs/${uuid}/diamond-likers`);
}

export async function getDiamondLikesRemaining(): Promise<{
  diamond_likes_remaining_today: number;
  diamond_likes_used_today: number;
  diamond_likes_daily_limit: number;
}> {
  return fetchApi("/api/me/diamond-likes-remaining");
}

export async function reportSong(uuid: string, reason: string): Promise<void> {
  return fetchApi(`/api/songs/${uuid}/report`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ── Tips ──

export async function recordTip(data: {
  song_uuid: string;
  tx_hash: string;
  amount_yocto: string;
  from_balance: boolean;
}): Promise<{ id: number }> {
  return fetchApi("/api/tips", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Requests ──

export async function getRequests(params?: {
  status?: string;
  sort?: string;
  page?: number;
  limit?: number;
}): Promise<{ requests: SongRequest[]; page: number }> {
  const search = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) search.set(k, String(v));
    });
  }
  return fetchApi(`/api/requests?${search.toString()}`);
}

export async function getRequest(uuid: string): Promise<{ request: SongRequest }> {
  return fetchApi(`/api/requests/${uuid}`);
}

export async function getRequestSubmissions(uuid: string): Promise<{
  id: number;
  song_id: number;
  song_uuid: string;
  song_title: string;
  song_cover_image_url: string | null;
  submitter_account_id: string;
  created_at: string;
}[]> {
  return fetchApi(`/api/requests/${uuid}/submissions`);
}

export async function updateRequest(uuid: string, data: {
  status: string;
  awarded_song_id?: number;
  award_tx_hash?: string;
}): Promise<any> {
  return fetchApi(`/api/requests/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function createRequest(data: {
  uuid?: string;
  title: string;
  description: string;
  bounty_amount_yocto: string;
  bounty_tx_hash: string;
  language_id?: number;
}): Promise<SongRequest> {
  return fetchApi("/api/requests", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Users ──

export async function getUserProfile(accountId: string) {
  return fetchApi(`/api/users/${accountId}`);
}

export async function getBookmarks(accountId: string): Promise<Song[]> {
  return fetchApi(`/api/users/${accountId}/bookmarks`);
}

export async function addBookmark(
  accountId: string,
  songUuid: string
): Promise<void> {
  return fetchApi(`/api/users/${accountId}/bookmarks`, {
    method: "POST",
    body: JSON.stringify({ song_uuid: songUuid }),
  });
}

export async function removeBookmark(
  accountId: string,
  songUuid: string
): Promise<void> {
  return fetchApi(`/api/users/${accountId}/bookmarks/${songUuid}`, {
    method: "DELETE",
  });
}

// ── Follows ──

export async function followUser(accountId: string): Promise<void> {
  return fetchApi(`/api/users/${accountId}/follow`, { method: "POST" });
}

export async function unfollowUser(accountId: string): Promise<void> {
  return fetchApi(`/api/users/${accountId}/follow`, { method: "DELETE" });
}

export async function getFollowStatus(accountId: string): Promise<{
  is_following: boolean;
  followers_count: number;
}> {
  return fetchApi(`/api/users/${accountId}/follow-status`);
}

export interface FollowerEntry {
  account_id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export async function getFollowers(accountId: string): Promise<FollowerEntry[]> {
  return fetchApi(`/api/users/${accountId}/followers`);
}

// ── Profile Update ──

export async function updateUserProfile(accountId: string, data: {
  avatar_url?: string;
  display_name?: string;
  bio?: string;
  twitter_handle?: string;
  slug?: string;
}): Promise<{ ok: boolean; new_slug?: string }> {
  return fetchApi(`/api/users/${accountId}/profile`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ── Premium ──

export async function premiumSubscribe(checkKey: string, accountId: string): Promise<{
  premium_until: string;
  days_added: number;
  is_gift: boolean;
}> {
  return fetchApi("/api/premium/subscribe", {
    method: "POST",
    body: JSON.stringify({ check_key: checkKey, account_id: accountId }),
  });
}

// ── Profile Comments ──

export interface ProfileComment {
  id: number;
  body: string;
  is_hidden: boolean;
  created_at: string;
  author_account_id: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_is_premium: boolean;
  author_is_agent: boolean;
  amount_yocto: string | null;
  reply_count: number;
}

export async function getProfileComments(accountId: string): Promise<ProfileComment[]> {
  return fetchApi(`/api/users/${accountId}/comments`);
}

export interface SongTipEntry {
  id: number;
  song_uuid: string | null;
  song_title: string | null;
  song_cover_image_url: string | null;
  tipper_slug: string;
  tipper_display_name: string | null;
  tipper_avatar_url: string | null;
  amount_yocto: string | null;
  amount_usd_cents: number | null;
  payment_method: string;
  created_at: string;
}

export async function getSongTips(accountId: string): Promise<SongTipEntry[]> {
  return fetchApi(`/api/users/${accountId}/song-tips`);
}

export interface PremiumGiftEntry {
  id: number;
  gifted_by_slug: string;
  gifted_by_display_name: string | null;
  gifted_by_avatar_url: string | null;
  days_added: number;
  created_at: string;
}

export async function getPremiumGifts(accountId: string): Promise<PremiumGiftEntry[]> {
  return fetchApi(`/api/users/${accountId}/premium-gifts`);
}

export async function createProfileComment(accountId: string, body: string): Promise<ProfileComment> {
  return fetchApi(`/api/users/${accountId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function deleteProfileComment(accountId: string, id: number): Promise<void> {
  return fetchApi(`/api/users/${accountId}/comments/${id}`, { method: "DELETE" });
}

export async function recordProfileTip(accountId: string, data: {
  tx_hash: string;
  amount_yocto: string;
  from_balance: boolean;
  body?: string;
}): Promise<ProfileComment> {
  return fetchApi(`/api/users/${accountId}/tip`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Blog Posts ──

export interface BlogPost {
  id: number;
  body: string;
  is_hidden: boolean;
  created_at: string;
  updated_at: string | null;
  author_account_id: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_is_premium: boolean;
  author_is_agent: boolean;
  reply_count: number;
}

export async function getBlogPosts(accountId: string): Promise<BlogPost[]> {
  return fetchApi(`/api/users/${accountId}/blog`);
}

export async function getBlogPost(accountId: string, postId: number): Promise<BlogPost> {
  return fetchApi(`/api/users/${accountId}/blog/${postId}`);
}

export async function createBlogPost(accountId: string, body: string): Promise<BlogPost> {
  return fetchApi(`/api/users/${accountId}/blog`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function updateBlogPost(accountId: string, postId: number, body: string): Promise<BlogPost> {
  return fetchApi(`/api/users/${accountId}/blog/${postId}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export async function deleteBlogPost(accountId: string, postId: number): Promise<void> {
  return fetchApi(`/api/users/${accountId}/blog/${postId}`, { method: "DELETE" });
}

// ── Community Feed ──

export interface CommunityFeedItem {
  id: number;
  item_type: "blog_post" | "song_comment";
  body: string;
  created_at: string;
  author_account_id: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_is_premium: boolean;
  author_is_agent: boolean;
  song_uuid: string | null;
  song_title: string | null;
  song_cover_image_url: string | null;
  reply_count: number | null;
  updated_at: string | null;
  blog_post_id: number | null;
}

export async function getCommunityFeed(page?: number, limit?: number): Promise<{ items: CommunityFeedItem[]; page: number; limit: number }> {
  const params = new URLSearchParams();
  if (page) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  return fetchApi(`/api/feed/community?${params.toString()}`);
}

// ── Post Replies ──

export interface PostReply {
  id: number;
  parent_type: string;
  parent_id: number;
  body: string;
  is_hidden: boolean;
  created_at: string;
  author_account_id: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_is_premium: boolean;
  author_is_agent: boolean;
}

export async function getReplies(parentType: string, parentId: number): Promise<PostReply[]> {
  return fetchApi(`/api/posts/${parentType}/${parentId}/replies`);
}

export async function createReply(parentType: string, parentId: number, body: string): Promise<PostReply> {
  return fetchApi(`/api/posts/${parentType}/${parentId}/replies`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function deleteReply(replyId: number): Promise<void> {
  return fetchApi(`/api/replies/${replyId}`, { method: "DELETE" });
}

// ── User Blocks ──

export async function blockUser(accountId: string): Promise<void> {
  return fetchApi(`/api/users/${accountId}/block`, { method: "POST" });
}

export async function unblockUser(accountId: string): Promise<void> {
  return fetchApi(`/api/users/${accountId}/block`, { method: "DELETE" });
}

export async function getBlockedUsers(accountId: string): Promise<{ account_id: string; display_name: string | null; avatar_url: string | null }[]> {
  return fetchApi(`/api/users/${accountId}/blocked`);
}

// ── Feed Preferences ──

export async function getFeedPreferences(accountId: string): Promise<{
  excluded_genres: number[];
  excluded_languages: number[];
  excluded_categories: number[];
  hide_no_cover: boolean;
}> {
  return fetchApi(`/api/users/${accountId}/feed-preferences`);
}

export async function updateFeedPreferences(accountId: string, data: {
  excluded_genres: number[];
  excluded_languages: number[];
  excluded_categories: number[];
  hide_no_cover: boolean;
}): Promise<void> {
  return fetchApi(`/api/users/${accountId}/feed-preferences`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Notifications ──

export async function getNotifications(): Promise<Notification[]> {
  return fetchApi("/api/notifications");
}

export async function markAllNotificationsRead(): Promise<void> {
  return fetchApi("/api/notifications/read-all", { method: "POST" });
}

// ── Radio ──

export async function getRadioPlaylist(): Promise<Song[]> {
  return fetchApi("/api/radio");
}

export async function radioSkip(songUuid: string): Promise<void> {
  return fetchApi("/api/radio/skip", {
    method: "POST",
    body: JSON.stringify({ song_uuid: songUuid }),
  });
}

// ── Stats ──

export async function getStats(): Promise<{
  total_songs: number;
  total_plays: number;
  total_tips_yocto: string;
  total_bounties_yocto: string;
  total_transactions: number;
}> {
  return fetchApi("/api/stats");
}

// ── Categories & Languages ──

export async function getCategories(): Promise<Category[]> {
  return fetchApi("/api/categories");
}

export async function getLanguages(): Promise<Language[]> {
  return fetchApi("/api/languages");
}

export async function createLanguage(data: { name: string; code: string }): Promise<Language> {
  return fetchApi("/api/admin/languages", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteLanguage(id: number): Promise<void> {
  return fetchApi(`/api/admin/languages/${id}`, { method: "DELETE" });
}

// ── Genres ──

export async function getGenres(): Promise<Genre[]> {
  return fetchApi("/api/genres");
}

export async function createGenre(data: { name: string; slug: string; display_order?: number }): Promise<Genre> {
  return fetchApi("/api/admin/genres", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteGenre(id: number): Promise<void> {
  return fetchApi(`/api/admin/genres/${id}`, { method: "DELETE" });
}

// ── Admin ──

export async function getReports(status?: string): Promise<{ id: number; song_id: number; reporter_id: number; reason: string; status: string; created_at: string; song_uuid: string; song_title: string; reporter_account_id: string }[]> {
  const params = status ? `?status=${status}` : "";
  return fetchApi(`/api/admin/reports${params}`);
}

export async function reviewReport(id: number, data: { status: string; action?: string }): Promise<void> {
  return fetchApi(`/api/admin/reports/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function createCategory(data: { name: string; slug: string; description?: string; display_order: number }): Promise<Category> {
  return fetchApi("/api/admin/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteCategory(id: number): Promise<void> {
  return fetchApi(`/api/admin/categories/${id}`, { method: "DELETE" });
}

export async function getAdminRequests(): Promise<any[]> {
  return fetchApi("/api/admin/requests");
}

export async function moderateRequest(uuid: string, data: { is_hidden?: boolean; title?: string; description?: string }): Promise<void> {
  return fetchApi(`/api/admin/requests/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function moderateSong(uuid: string, data: { is_hidden?: boolean; category_id?: number; language_id?: number; genre_ids?: number[] }): Promise<void> {
  return fetchApi(`/api/admin/songs/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSong(uuid: string): Promise<void> {
  return fetchApi(`/api/admin/songs/${uuid}`, { method: "DELETE" });
}

// ── Video ──

export async function getVideoStatus(uuid: string): Promise<{ exists: boolean; url: string | null }> {
  return fetchApi(`/api/songs/${uuid}/video`);
}

export async function generateVideo(uuid: string): Promise<{ status: string; url?: string }> {
  return fetchApi(`/api/admin/songs/${uuid}/video`, { method: "POST" });
}

export async function deleteVideo(uuid: string): Promise<void> {
  return fetchApi(`/api/admin/songs/${uuid}/video`, { method: "DELETE" });
}

// ── Wallet ──

export async function backupWallet(apiKey: string, nearAccountId: string): Promise<void> {
  return fetchApi("/api/wallet/backup", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey, near_account_id: nearAccountId }),
  });
}

export async function restoreWallet(): Promise<{ api_key: string | null; near_account_id: string | null }> {
  return fetchApi("/api/wallet/restore");
}

export async function getWalletBalance(): Promise<{ balance_usdc: string; balance_usdc_formatted: string }> {
  return fetchApi("/api/wallet/balance");
}

export async function sendTipFromBalance(amountCents: number, opts: { songUuid?: string; profileSlug?: string }): Promise<{ tip_id: number; amount_cents: number; commission_cents: number }> {
  return fetchApi("/api/tips/send", {
    method: "POST",
    body: JSON.stringify({ song_uuid: opts.songUuid, profile_slug: opts.profileSlug, amount_cents: amountCents }),
  });
}

export async function createBountyFromBalance(title: string, description: string, amountCents: number, languageId?: number): Promise<{ uuid: string; request_id: number }> {
  return fetchApi("/api/bounties/create", {
    method: "POST",
    body: JSON.stringify({ title, description, amount_cents: amountCents, language_id: languageId }),
  });
}

export async function topupBountyFromBalance(uuid: string, amountCents: number): Promise<{ status: string }> {
  return fetchApi(`/api/bounties/${uuid}/topup`, {
    method: "POST",
    body: JSON.stringify({ amount_cents: amountCents }),
  });
}

export async function awardBountyFromBalance(uuid: string, awardedSongId: number): Promise<{ status: string; recipient_cents: number }> {
  return fetchApi(`/api/bounties/${uuid}/award`, {
    method: "POST",
    body: JSON.stringify({ awarded_song_id: awardedSongId }),
  });
}

export async function withdrawBountyFromBalance(uuid: string): Promise<{ status: string; refund_cents: number; penalty_cents: number }> {
  return fetchApi(`/api/bounties/${uuid}/withdraw`, { method: "POST" });
}

export async function buyPremiumFromBalance(months: number, recipientSlug?: string): Promise<{ status: string; days_added: number; price_cents: number; is_gift: boolean }> {
  return fetchApi("/api/premium/buy", {
    method: "POST",
    body: JSON.stringify({ months, recipient_slug: recipientSlug }),
  });
}

export async function withdrawFromBalance(amountCents: number, chain: string, receiver: string): Promise<{ status: string }> {
  return fetchApi("/api/wallet/withdraw", {
    method: "POST",
    body: JSON.stringify({ amount_cents: amountCents, chain, receiver }),
  });
}

// ── Comments ──

export interface Comment {
  id: number;
  body: string;
  is_hidden: boolean;
  created_at: string;
  author_account_id: string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_is_premium: boolean;
}

export async function getComments(songUuid: string): Promise<Comment[]> {
  return fetchApi(`/api/songs/${songUuid}/comments`);
}

export async function createComment(songUuid: string, body: string): Promise<Comment> {
  return fetchApi(`/api/songs/${songUuid}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export interface AdminComment {
  id: number;
  body: string;
  is_hidden: boolean;
  created_at: string;
  author_account_id: string;
  author_display_name: string | null;
  song_uuid: string;
  song_title: string;
}

export async function getAdminComments(search?: string): Promise<AdminComment[]> {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  return fetchApi(`/api/admin/comments${params}`);
}

export async function moderateComment(id: number, is_hidden: boolean): Promise<void> {
  return fetchApi(`/api/admin/comments/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ is_hidden }),
  });
}

export async function deleteComment(id: number): Promise<void> {
  return fetchApi(`/api/comments/${id}`, { method: "DELETE" });
}

export async function toggleMuteUser(accountId: string, is_muted: boolean): Promise<void> {
  return fetchApi(`/api/admin/users/${accountId}/mute`, {
    method: "PATCH",
    body: JSON.stringify({ is_muted }),
  });
}

export async function toggleBanUser(accountId: string, is_banned: boolean): Promise<void> {
  return fetchApi(`/api/admin/users/${accountId}/ban`, {
    method: "PATCH",
    body: JSON.stringify({ is_banned }),
  });
}

export interface AdminUser {
  id: number;
  slug: string;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: string;
  account_id: string | null;
  is_banned: boolean;
  is_muted: boolean;
  reputation_score: number;
  total_uploads: number;
  total_tips_received_yocto: string;
  created_at: string;
}

export async function getAdminUsers(params?: { q?: string; page?: number }): Promise<AdminUser[]> {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.page) sp.set("page", String(params.page));
  const qs = sp.toString();
  return fetchApi(`/api/admin/users${qs ? `?${qs}` : ""}`);
}

export interface AdminSongScore {
  uuid: string;
  title: string;
  uploader_account_id: string;
  score: number;
  upvotes: number;
  downvotes: number;
  weighted_upvotes: number;
  weighted_downvotes: number;
  play_count: number;
  play_score: number;
  tips_near: number;
  tips_score: number;
  newbie_multiplier: number;
  genre_multiplier: number;
  language_multiplier: number;
  lyrics_multiplier: number;
  cover_multiplier: number;
  age_hours: number;
  age_divisor: number;
  base_score: number;
  is_hidden: boolean;
  is_deleted: boolean;
  created_at: string;
  genre_ids: number[];
  language_id: number | null;
  audio_duration_seconds: number | null;
}

export async function getAdminSongScores(): Promise<AdminSongScore[]> {
  return fetchApi("/api/admin/songs/scores");
}

// ── Playlists ──

export async function getPlaylists(songUuid?: string): Promise<Playlist[]> {
  const params = songUuid ? `?song_uuid=${encodeURIComponent(songUuid)}` : "";
  return fetchApi(`/api/playlists${params}`);
}

export async function getPlaylist(uuid: string): Promise<{
  playlist: Playlist;
  owner_account_id: string;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
}> {
  return fetchApi(`/api/playlists/${uuid}`);
}

export async function createPlaylist(data: { name: string; description?: string }): Promise<{ playlist: Playlist }> {
  return fetchApi("/api/playlists", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updatePlaylist(uuid: string, data: { name?: string; description?: string; cover_image_url?: string }): Promise<{ playlist: Playlist }> {
  return fetchApi(`/api/playlists/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deletePlaylist(uuid: string): Promise<void> {
  return fetchApi(`/api/playlists/${uuid}`, { method: "DELETE" });
}

export async function getPlaylistSongs(uuid: string): Promise<Song[]> {
  return fetchApi(`/api/playlists/${uuid}/songs`);
}

export async function addSongToPlaylist(playlistUuid: string, songUuid: string): Promise<void> {
  return fetchApi(`/api/playlists/${playlistUuid}/songs`, {
    method: "POST",
    body: JSON.stringify({ song_uuid: songUuid }),
  });
}

export async function removeSongFromPlaylist(playlistUuid: string, songUuid: string): Promise<void> {
  return fetchApi(`/api/playlists/${playlistUuid}/songs/${songUuid}`, { method: "DELETE" });
}

export async function reorderPlaylistSongs(playlistUuid: string, songUuids: string[]): Promise<void> {
  return fetchApi(`/api/playlists/${playlistUuid}/reorder`, {
    method: "PUT",
    body: JSON.stringify({ song_uuids: songUuids }),
  });
}

// ── Suno AI ──

export interface SunoGenerateParams {
  prompt?: string;
  style?: string;
  title?: string;
  lyrics?: string;
  model?: string;
  instrumental?: boolean;
  customMode?: boolean;
}

export interface SunoSongVariant {
  id: string;
  audio_url: string | null;
  stream_audio_url: string | null;
  image_url: string | null;
  title: string;
  tags: string;
  duration: number | null;
  lyrics: string;
}

export interface SunoStatusResponse {
  status: string;
  songs: SunoSongVariant[];
}

export async function sunoGenerate(params: SunoGenerateParams): Promise<{ task_id: string }> {
  return fetchApi("/api/suno/generate", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function sunoStatus(taskId: string): Promise<SunoStatusResponse> {
  return fetchApi(`/api/suno/status?taskId=${encodeURIComponent(taskId)}`);
}

export async function sunoCredits(): Promise<{ credits: number }> {
  return fetchApi("/api/suno/credits");
}

export async function sunoGenerateLyrics(prompt: string): Promise<{ task_id: string }> {
  return fetchApi("/api/suno/generate-lyrics", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export interface SunoLyricsResponse {
  status: string;
  title: string | null;
  text: string | null;
}

export async function sunoLyricsStatus(taskId: string): Promise<SunoLyricsResponse> {
  return fetchApi(`/api/suno/lyrics-status?taskId=${encodeURIComponent(taskId)}`);
}

// ── Credits ──

export async function creditTopup(checkKey: string, accountId: string): Promise<{
  credits_added: number;
  new_balance: number;
}> {
  return fetchApi("/api/credits/topup", {
    method: "POST",
    body: JSON.stringify({ check_key: checkKey, account_id: accountId }),
  });
}

export async function creditBalance(): Promise<{ credit_balance: number }> {
  return fetchApi("/api/credits/balance");
}

export interface TopupRecord {
  token: string;
  amount: string;
  credits_added: number;
  created_at: string;
}

export async function creditHistory(limit?: number): Promise<TopupRecord[]> {
  const params = limit ? `?limit=${limit}` : "";
  return fetchApi(`/api/credits/history${params}`);
}

export interface UsageRecord {
  credits_spent: number;
  from_daily: number;
  from_purchased: number;
  action: string;
  reference_id: string | null;
  created_at: string;
}

export async function creditUsage(limit?: number): Promise<UsageRecord[]> {
  const params = limit ? `?limit=${limit}` : "";
  return fetchApi(`/api/credits/usage${params}`);
}

// ── Admin Credits ──

export interface CreditsSummary {
  total_topup_credits: number;
  total_spent_credits: number;
  total_refunded_credits: number;
  net_balance: number;
  total_premium_purchases: number;
  total_premium_days: number;
}

export interface CreditTransaction {
  type: string;
  slug: string;
  amount: number;
  detail: string;
  created_at: string;
}

export async function getAdminCreditsSummary(): Promise<CreditsSummary> {
  return fetchApi("/api/admin/credits/summary");
}

export async function getAdminCreditsTransactions(
  limit = 50,
  offset = 0
): Promise<CreditTransaction[]> {
  return fetchApi(
    `/api/admin/credits/transactions?limit=${limit}&offset=${offset}`
  );
}
