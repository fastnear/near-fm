import type { Song, Category, Language, SongRequest, Notification } from "@/types";

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

  if (res.status === 204 || res.status === 201) {
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text);
  }
  return res.json();
}

// ── Auth ──

export async function verifyAuth(payload: {
  account_id: string;
  public_key: string;
  signature: string;
  message: string;
  nonce: number[];
  recipient: string;
}): Promise<{
  token: string;
  user: { id: number; account_id: string; display_name: string | null; is_admin: boolean; reputation_score: string };
}> {
  return fetchApi("/api/auth/verify", {
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
  fulfills_request_id?: number;
}): Promise<Song> {
  return fetchApi("/api/songs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getUserVote(
  uuid: string
): Promise<{ upvotes: number; downvotes: number; user_vote: number }> {
  return fetchApi(`/api/songs/${uuid}/vote`);
}

export async function voteSong(
  uuid: string,
  value: 1 | -1 | 0
): Promise<{ upvotes: number; downvotes: number; user_vote: number }> {
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

export async function createRequest(data: {
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

// ── Notifications ──

export async function getNotifications(): Promise<Notification[]> {
  return fetchApi("/api/notifications");
}

export async function markAllNotificationsRead(): Promise<void> {
  return fetchApi("/api/notifications/read-all", { method: "POST" });
}

// ── Categories & Languages ──

export async function getCategories(): Promise<Category[]> {
  return fetchApi("/api/categories");
}

export async function getLanguages(): Promise<Language[]> {
  return fetchApi("/api/languages");
}

// ── Admin ──

export async function getReports(status?: string): Promise<{ id: number; song_id: number; reporter_id: number; reason: string; status: string; created_at: string }[]> {
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

export async function moderateSong(uuid: string, data: { is_hidden?: boolean; category_id?: number }): Promise<void> {
  return fetchApi(`/api/admin/songs/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSong(uuid: string): Promise<void> {
  return fetchApi(`/api/admin/songs/${uuid}`, { method: "DELETE" });
}
