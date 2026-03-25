"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import type { Song, Category, Language, Playlist } from "@/types";
import { getSong, updateSong, reportSong, moderateSong, getComments, createComment, moderateComment, deleteComment, getCategories, getLanguages, getPlaylists, addSongToPlaylist, getVideoStatus, generateVideo, deleteVideo } from "@/lib/api";
import { GenrePicker } from "@/components/song/GenrePicker";
import type { Comment } from "@/lib/api";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getRadioPlaylist } from "@/lib/api";
import {
  prepareFastFSUpload,
  uploadToFastFS,
  computeFileHash,
  getFastFSUrl,
  getRelativePath,
} from "@/lib/near/fastfs";
import { VoteButtons } from "@/components/song/VoteButtons";
import { TipButton } from "@/components/song/TipButton";
import { FollowButton } from "@/components/song/FollowButton";
import { renderWithMentions } from "@/lib/mentions";

function truncateId(id: string, max = 30): string {
  if (id.length <= max) return id;
  return `${id.slice(0, 12)}...${id.slice(-8)}`;
}

export function SongDetail({ uuid: initialUuid }: { uuid: string }) {
  const [activeUuid, setActiveUuid] = useState(initialUuid);
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportReason, setReportReason] = useState("");
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", description: "", lyrics: "", ai_model: "", genre_ids: [] as number[], language_id: undefined as number | undefined, category_id: undefined as number | undefined });
  const [editSaving, setEditSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [showPlaylistDropdown, setShowPlaylistDropdown] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const [addedToPlaylist, setAddedToPlaylist] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [videoStatus, setVideoStatus] = useState<{ exists: boolean; url: string | null }>({ exists: false, url: null });
  const [videoGenerating, setVideoGenerating] = useState(false);
  const { currentSong, isPlaying, togglePlay, playMode, setPlayMode, next, previous, startRadio, queue } = useAudioPlayer();
  const { user, isAuthenticated, promptSignIn } = useAuth();
  const { accountId, callFunction } = useNearWallet();

  // Track whether the user navigated here manually (should not auto-follow currentSong)
  // vs. the song changed automatically via radio/queue (should follow)
  const isFollowingPlayer = useRef(false);

  // When the component mounts or initialUuid changes (user navigated), stop auto-following
  useEffect(() => {
    isFollowingPlayer.current = false;
    setActiveUuid(initialUuid);
  }, [initialUuid]);

  // Start auto-following once the user plays the song that's on this page
  useEffect(() => {
    if (currentSong && currentSong.uuid === activeUuid) {
      isFollowingPlayer.current = true;
    }
  }, [currentSong, activeUuid]);

  // Follow the currently playing song: update page content + URL without reload
  // Only when we were already following (i.e. song auto-advanced from radio/queue)
  useEffect(() => {
    if (
      isFollowingPlayer.current &&
      currentSong &&
      currentSong.uuid !== activeUuid
    ) {
      setActiveUuid(currentSong.uuid);
      window.history.replaceState(null, "", `/song/${currentSong.uuid}`);
      document.title = `${currentSong.title} — near.fm`;
    }
  }, [currentSong, activeUuid]);

  useEffect(() => {
    setLoading(true);
    // Reset per-song state
    setShowReportForm(false);
    setReportSent(false);
    setReportReason("");
    setEditing(false);
    setCommentText("");
    setCommentError("");
    setComments([]);
    setCopied(false);

    getSong(activeUuid)
      .then((data) => setSong(data.song))
      .catch(console.error)
      .finally(() => setLoading(false));
    getVideoStatus(activeUuid).then(setVideoStatus).catch(() => {});
  }, [activeUuid]);

  // Poll for validation status updates
  useEffect(() => {
    if (!song || song.is_validated || song.is_hidden) return;
    const interval = setInterval(() => {
      getSong(activeUuid)
        .then((data) => setSong(data.song))
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [activeUuid, song?.is_validated, song?.is_hidden]);

  // Load comments
  useEffect(() => {
    if (activeUuid) {
      getComments(activeUuid).then(setComments).catch(console.error);
    }
  }, [activeUuid]);

  useEffect(() => {
    getCategories().then(setCategories).catch(console.error);
    getLanguages().then(setLanguages).catch(console.error);
  }, []);

  const userSlug = user?.slug;
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-8">
            <div className="w-full md:w-72 aspect-square rounded-2xl skeleton" />
            <div className="flex-1 space-y-4">
              <div className="h-8 rounded-xl skeleton w-2/3" />
              <div className="h-4 rounded-lg skeleton w-1/3" />
              <div className="h-20 rounded-xl skeleton" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!song) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-slate-500 text-lg">Song not found</p>
      </div>
    );
  }

  const isActive = currentSong?.uuid === song.uuid;
  const isAdmin = user?.is_admin;
  const canEdit = userSlug && (userSlug === song.uploader_account_id || isAdmin);

  const startEditing = () => {
    setEditForm({
      title: song.title,
      description: song.description || "",
      lyrics: song.lyrics || "",
      ai_model: song.ai_model || "",
      genre_ids: song.genres?.map((g) => g.id) || [],
      language_id: song.language_id ?? undefined,
      category_id: song.category_id ?? undefined,
    });
    setCoverFile(null);
    setCoverPreview(null);
    setEditing(true);
  };

  const handleCoverSelect = (file: File) => {
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setCoverPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const saveEdit = async () => {
    setEditSaving(true);
    try {
      let cover_image_url: string | undefined;

      // Upload cover to FastFS if a new one was selected
      if (coverFile && accountId) {
        setCoverUploading(true);
        const coverBuffer = await coverFile.arrayBuffer();
        const coverBytes = new Uint8Array(coverBuffer);
        const coverHash = await computeFileHash(coverBytes);
        const coverRelPath = getRelativePath(coverHash, coverFile.type || "image/jpeg");
        const coverParts = prepareFastFSUpload(coverRelPath, coverFile.type || "image/jpeg", coverBytes);
        await uploadToFastFS((params) => callFunction(params), coverParts);
        cover_image_url = getFastFSUrl(accountId, coverRelPath);
        setCoverUploading(false);
      }

      const result = await updateSong(song.uuid, {
        title: editForm.title.trim() || undefined,
        description: editForm.description.trim() || undefined,
        lyrics: editForm.lyrics.trim() || undefined,
        ai_model: editForm.ai_model.trim() || undefined,
        genre_ids: editForm.genre_ids,
        language_id: editForm.language_id,
        category_id: editForm.category_id,
        cover_image_url,
      });
      setSong(result.song);
      setCoverFile(null);
      setCoverPreview(null);
      setEditing(false);
    } catch (e) {
      console.error("Update failed:", e);
      setCoverUploading(false);
    }
    setEditSaving(false);
  };

  const removeCover = async () => {
    if (!window.confirm("Remove cover image?")) return;
    try {
      const result = await updateSong(song.uuid, { remove_cover: true });
      setSong(result.song);
    } catch (e) {
      console.error("Remove cover failed:", e);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* Pending validation banner */}
      {!song.is_validated && !song.is_hidden && (
        <div className="mb-6 flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl px-4 py-3 text-sm">
          <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          Waiting for decentralized storage indexing. Your song will appear in the feed once the audio file is available.
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-8">
        {/* Cover */}
        <div className="relative w-full md:w-80 flex-shrink-0 self-start">
          <div className="aspect-square rounded-2xl overflow-hidden ring-1 ring-white/[0.06] shadow-2xl">
            {song.cover_image_url ? (
              <img
                src={song.cover_image_url}
                alt={song.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-cyan-900/50 flex items-center justify-center">
                <svg className="w-20 h-20 text-white/15" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </div>

          {/* Play button overlay */}
          <button
            onClick={() => togglePlay(song)}
            className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-all duration-300"
          >
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 hover:scale-110 ${
                isActive && isPlaying
                  ? "bg-gradient-to-r from-purple-500 to-cyan-500 animate-pulse-glow"
                  : "bg-gradient-to-r from-purple-500 to-purple-600 shadow-purple-500/30"
              }`}
            >
              {isActive && isPlaying ? (
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              ) : (
                <svg className="w-7 h-7 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </div>
          </button>

          {/* Player controls (mobile) */}
          {isActive && (
            <div className="flex items-center justify-center gap-3 mt-3 md:hidden">
              <button
                onClick={previous}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all"
                title="Previous"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                </svg>
              </button>
              <button
                onClick={next}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all"
                title="Next"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                </svg>
              </button>
              <button
                onClick={() => {
                  const modes: Array<"radio" | "repeat" | "none"> = ["radio", "repeat", "none"];
                  const idx = modes.indexOf(playMode);
                  setPlayMode(modes[(idx + 1) % 3]);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  playMode === "radio"
                    ? "text-purple-400 bg-purple-500/15 border border-purple-500/20"
                    : playMode === "repeat"
                    ? "text-cyan-400 bg-cyan-500/15 border border-cyan-500/20"
                    : "text-slate-500 bg-white/[0.04] border border-white/[0.06]"
                }`}
                title={playMode === "radio" ? "Radio mode: plays similar songs" : playMode === "repeat" ? "Repeat: loops this song" : "Off: stops after this song"}
              >
                {playMode === "radio" && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
                  </svg>
                )}
                {playMode === "repeat" && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {playMode === "none" && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                )}
                {playMode === "radio" ? "Radio" : playMode === "repeat" ? "Repeat" : "Off"}
              </button>
              {playMode === "radio" && queue.length === 0 && (
                <button
                  onClick={async () => {
                    try {
                      const songs = await getRadioPlaylist();
                      if (songs.length > 0) startRadio(songs);
                    } catch {}
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-purple-400 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-all"
                  title="Load AI Radio playlist"
                >
                  Load Radio
                </button>
              )}
            </div>
          )}

          {/* Remove cover button — admin only (authors cannot change cover once set) */}
          {isAdmin && song.cover_image_url && (
            <button
              onClick={removeCover}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-slate-400 hover:text-rose-400 transition-colors"
              title="Remove cover image"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full rounded-xl px-4 py-2 border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-xl px-4 py-2 border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Lyrics</label>
                <textarea
                  value={editForm.lyrics}
                  onChange={(e) => setEditForm({ ...editForm, lyrics: e.target.value })}
                  rows={6}
                  className="w-full rounded-xl px-4 py-2 border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none resize-none font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">AI Model</label>
                <input
                  type="text"
                  value={editForm.ai_model}
                  onChange={(e) => setEditForm({ ...editForm, ai_model: e.target.value })}
                  className="w-full rounded-xl px-4 py-2 border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Genres (up to 3)</label>
                <GenrePicker
                  selectedIds={editForm.genre_ids}
                  onChange={(ids) => setEditForm({ ...editForm, genre_ids: ids })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Language</label>
                  <select
                    value={editForm.language_id ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, language_id: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full rounded-xl px-3 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none appearance-none cursor-pointer"
                  >
                    <option value="">Not set</option>
                    {languages.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Category</label>
                  <select
                    value={editForm.category_id ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full rounded-xl px-3 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none appearance-none cursor-pointer"
                  >
                    <option value="">Not set</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Cover image upload — only if song has no cover yet */}
              {!song.cover_image_url && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Cover Image</label>
                  {coverPreview ? (
                    <div className="flex items-center gap-3">
                      <img src={coverPreview} alt="Cover preview" className="w-20 h-20 rounded-xl object-cover ring-1 ring-white/[0.08]" />
                      <button
                        onClick={() => { setCoverFile(null); setCoverPreview(null); }}
                        className="text-xs text-slate-400 hover:text-rose-400 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] cursor-pointer hover:border-purple-500/30 hover:bg-purple-500/[0.04] transition-all">
                      <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                      </svg>
                      <span className="text-sm text-slate-400">Add cover image</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleCoverSelect(f);
                        }}
                      />
                    </label>
                  )}
                  {coverFile && !accountId && (
                    <p className="text-xs text-amber-400 mt-1">Connect NEAR wallet to upload cover image</p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={editSaving || coverUploading || (!!coverFile && !accountId)}
                  className="px-5 py-2 btn-primary rounded-xl text-sm disabled:opacity-50"
                >
                  {coverUploading ? "Uploading cover..." : editSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setEditing(false); setCoverFile(null); setCoverPreview(null); }}
                  className="px-5 py-2 btn-ghost rounded-xl text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <h1 className="text-3xl font-bold text-white mb-2 flex-1">{song.title}</h1>
                {canEdit && (
                  <button
                    onClick={startEditing}
                    className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/profile/${song.uploader_account_id}`}
                  className="text-slate-400 hover:text-purple-400 transition-colors"
                  title={!song.uploader_display_name && song.uploader_account_id.length > 30 ? song.uploader_account_id : undefined}
                >
                  {song.uploader_display_name || truncateId(song.uploader_account_id)}
                </Link>
                {song.uploader_is_agent && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 border border-purple-500/20 text-purple-400">⚡ Agent</span>
                )}
                {userSlug && userSlug !== song.uploader_account_id && (
                  <FollowButton accountId={song.uploader_account_id} currentUser={userSlug} />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {song.category_name && (
                  <Link
                    href={`/?category=${song.category_id}`}
                    className="inline-block text-xs px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/15 hover:bg-purple-500/20 transition-colors"
                  >
                    {song.category_name}
                  </Link>
                )}
                {song.genres?.map((g) => (
                  <Link
                    key={g.id}
                    href={`/genre/${g.slug}`}
                    className="inline-block text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/15 hover:bg-cyan-500/20 transition-colors"
                  >
                    {g.name}
                  </Link>
                ))}
                {song.language_name && (
                  <Link
                    href={`/language/${song.language_code}`}
                    className="inline-block text-xs px-2.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                  >
                    {song.language_name}
                  </Link>
                )}
              </div>

              {song.created_on_nearfm && (
                <p className="text-xs text-purple-400 mt-1.5 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  Created on near.fm{song.ai_model ? ` with ${song.ai_model}` : ""}
                </p>
              )}
              {!song.created_on_nearfm && song.ai_model && (
                <p className="text-xs text-slate-600 mt-1.5 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Generated with {song.ai_model}
                </p>
              )}
            </>
          )}

          {/* Actions */}
          {!editing && (
            <>
              <div className="flex flex-wrap items-center gap-2.5 mt-6">
                <VoteButtons song={song} />
                <TipButton song={song} onTipSuccess={() => {
                  getSong(activeUuid).then((data) => setSong(data.song)).catch(() => {});
                }} />

                {/* Share */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  {copied ? "Copied!" : "Share"}
                </button>

                {/* Share on X */}
                <a
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(`${song.title}${song.uploader_twitter_handle ? ` by @${song.uploader_twitter_handle}` : ""} — listen on near.fm, decentralized platform for AI-generated music on NEAR\n\n${window.location.href}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Post
                </a>

                {/* Download */}
                <a
                  href={song.audio_url}
                  download
                  className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </a>

                {/* Report */}
                <button
                  onClick={() => {
                    if (!isAuthenticated) {
                      promptSignIn();
                      return;
                    }
                    setShowReportForm(!showReportForm);
                  }}
                  className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5 hover:!text-rose-400 hover:!border-rose-500/20 hover:!bg-rose-500/10"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                  </svg>
                  Report
                </button>

                {/* Add to Playlist */}
                {user?.is_premium && (
                  <div className="relative">
                    <button
                      onClick={async () => {
                        if (!playlistsLoaded || showPlaylistDropdown === false) {
                          try {
                            const data = await getPlaylists(song.uuid);
                            setUserPlaylists(data.filter((p: Playlist) => !p.is_auto));
                            setPlaylistsLoaded(true);
                          } catch (e) {
                            console.error("Failed to load playlists:", e);
                          }
                        }
                        setShowPlaylistDropdown(!showPlaylistDropdown);
                        setAddedToPlaylist(null);
                      }}
                      className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      {addedToPlaylist ? "Added!" : "Playlist"}
                    </button>
                    {showPlaylistDropdown && (
                      <div className="absolute z-50 top-full mt-1 left-0 w-56 rounded-xl border border-white/[0.1] shadow-2xl overflow-hidden bg-[#1a1a2e]">
                        {userPlaylists.length === 0 ? (
                          <p className="text-xs text-slate-500 px-3 py-3">No playlists. Create one in Cabinet.</p>
                        ) : (
                          userPlaylists.map((pl) => {
                            const alreadyIn = pl.contains_song === true;
                            return (
                              <button
                                key={pl.uuid}
                                onClick={async () => {
                                  if (alreadyIn) return;
                                  try {
                                    await addSongToPlaylist(pl.uuid, song.uuid);
                                    setAddedToPlaylist(pl.uuid);
                                    setUserPlaylists((prev) => prev.map((p) =>
                                      p.uuid === pl.uuid ? { ...p, contains_song: true, song_count: p.song_count + 1 } : p
                                    ));
                                    setTimeout(() => { setAddedToPlaylist(null); setShowPlaylistDropdown(false); }, 800);
                                  } catch (e: any) {
                                    console.error("Add to playlist failed:", e);
                                  }
                                }}
                                disabled={alreadyIn}
                                className={`w-full text-left px-3 py-2.5 text-sm transition flex items-center gap-2 ${
                                  alreadyIn
                                    ? "text-slate-500 cursor-default"
                                    : "text-slate-300 hover:bg-white/[0.08] hover:text-white"
                                }`}
                              >
                                {alreadyIn ? (
                                  <svg className="w-4 h-4 text-[#00ec97] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                  </svg>
                                )}
                                <span className="truncate flex-1">{pl.name}</span>
                                <span className="text-xs text-slate-600">{pl.song_count}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Admin: Video */}
                {isAdmin && (
                  videoStatus.exists ? (
                    <div className="flex items-center gap-1.5">
                      <a
                        href={videoStatus.url!}
                        download
                        className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5 !text-purple-400 !border-purple-500/20 !bg-purple-500/10"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Download Video
                      </a>
                      <button
                        onClick={async () => {
                          if (!window.confirm("Delete generated video?")) return;
                          try {
                            await deleteVideo(song.uuid);
                            setVideoStatus({ exists: false, url: null });
                          } catch (e) { console.error("Delete video failed:", e); }
                        }}
                        className="btn-ghost px-2 py-1.5 text-sm rounded-xl hover:!text-rose-400"
                        title="Delete video"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={async () => {
                        setVideoGenerating(true);
                        try {
                          const res = await generateVideo(song.uuid);
                          if (res.status === "exists") {
                            setVideoStatus({ exists: true, url: res.url || null });
                          } else {
                            // Poll for completion
                            const poll = setInterval(async () => {
                              const s = await getVideoStatus(song.uuid);
                              if (s.exists) {
                                setVideoStatus(s);
                                setVideoGenerating(false);
                                clearInterval(poll);
                              }
                            }, 5000);
                            setTimeout(() => { clearInterval(poll); setVideoGenerating(false); }, 300000);
                          }
                        } catch (e) {
                          console.error("Generate video failed:", e);
                          setVideoGenerating(false);
                        }
                      }}
                      disabled={videoGenerating}
                      className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5 hover:!text-purple-400 hover:!border-purple-500/20 hover:!bg-purple-500/10 disabled:opacity-50"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {videoGenerating ? "Generating..." : "Generate Video"}
                    </button>
                  )
                )}

                {/* Admin: Hide */}
                {isAdmin && (
                  <button
                    onClick={async () => {
                      const newHidden = !song.is_hidden;
                      if (newHidden && !window.confirm("Hide this song from public view?")) return;
                      try {
                        await moderateSong(song.uuid, { is_hidden: newHidden });
                        setSong({ ...song, is_hidden: newHidden });
                      } catch (e) { console.error("Moderate failed:", e); }
                    }}
                    className={`btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5 ${
                      song.is_hidden
                        ? "!text-rose-400 !border-rose-500/20 !bg-rose-500/10"
                        : "hover:!text-rose-400 hover:!border-rose-500/20 hover:!bg-rose-500/10"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                    {song.is_hidden ? "Hidden" : "Hide"}
                  </button>
                )}
              </div>

              {/* Report form */}
              {showReportForm && !reportSent && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="Reason for report..."
                    className="flex-1 rounded-xl px-3 py-1.5 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      if (!reportReason.trim()) return;
                      try {
                        await reportSong(song.uuid, reportReason.trim());
                        setReportSent(true);
                        setShowReportForm(false);
                      } catch (e) { console.error("Report failed:", e); }
                    }}
                    className="px-4 py-1.5 bg-rose-500 text-white text-sm font-medium rounded-xl hover:bg-rose-400 transition-colors"
                  >
                    Submit
                  </button>
                </div>
              )}
              {reportSent && (
                <p className="mt-3 text-sm text-[#00ec97] flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Report submitted. Thank you.
                </p>
              )}

              {/* Stats */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-5 text-sm">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  </svg>
                  {song.play_count} plays
                </span>
                <span className="flex items-center gap-1.5 text-slate-500">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                  </svg>
                  {song.upvotes} upvotes
                </span>
                {song.total_tips_yocto !== "0" && (
                  <span className="flex items-center gap-1.5 text-amber-500/80">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {(Number(song.total_tips_yocto) / 1e24).toFixed(2)} NEAR
                  </span>
                )}
              </div>

              {/* Dates */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
                <span>Added {new Date(song.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
                {song.updated_at && new Date(song.updated_at).toDateString() !== new Date(song.created_at).toDateString() && (
                  <span>Updated {new Date(song.updated_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
                )}
                {song.fulfills_request_uuid && (
                  <span>
                    Submitted for bounty{" "}
                    <Link href={`/requests/${song.fulfills_request_uuid}`} className="text-purple-400 hover:text-purple-300 transition-colors">
                      {song.fulfills_request_title || "request"}
                    </Link>
                  </span>
                )}
              </div>

              {/* Description */}
              {song.description && (
                <div className="mt-8">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                    Description
                  </h2>
                  <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {renderWithMentions(song.description)}
                  </p>
                </div>
              )}

              {/* Lyrics */}
              {song.lyrics && (
                <div className="mt-8">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                    Lyrics
                  </h2>
                  <pre className="text-slate-300 whitespace-pre-wrap font-sans text-sm glass rounded-2xl p-5 leading-relaxed">
                    {song.lyrics}
                  </pre>
                </div>
              )}

              {/* Comments */}
              <div className="mt-8">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                  Comments {comments.length > 0 && `(${comments.length})`}
                </h2>

                {/* Comment input */}
                {isAuthenticated ? (
                    <div className="mb-4">
                      <div className="flex gap-2">
                        <textarea
                          value={commentText}
                          onChange={(e) => {
                            setCommentText(e.target.value);
                            setCommentError("");
                          }}
                          placeholder="Write a comment..."
                          rows={2}
                          maxLength={2000}
                          className="flex-1 rounded-xl px-4 py-2.5 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-500 focus:border-purple-500 focus:outline-none resize-none"
                        />
                        <button
                          onClick={async () => {
                            if (!commentText.trim()) return;
                            setCommentSubmitting(true);
                            setCommentError("");
                            try {
                              const newComment = await createComment(activeUuid, commentText.trim());
                              setComments((prev) => [...prev, newComment]);
                              setCommentText("");
                            } catch (e: any) {
                              setCommentError(e instanceof Error ? e.message : "Failed to post comment");
                            }
                            setCommentSubmitting(false);
                          }}
                          disabled={commentSubmitting || !commentText.trim()}
                          className="self-end px-4 py-2.5 btn-primary rounded-xl text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {commentSubmitting ? "..." : "Post"}
                        </button>
                      </div>
                      {commentError && (
                        <p className="mt-1.5 text-xs text-rose-400">
                          {commentError.includes("banned") ? (
                            "Your account has been banned."
                          ) : commentError.includes("muted") ? (
                            "Your account has been muted."
                          ) : (
                            commentError
                          )}
                        </p>
                      )}
                    </div>
                ) : (
                  <p className="text-sm text-slate-500 mb-4">
                    <button onClick={promptSignIn} className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</button> to leave a comment.
                  </p>
                )}

                {/* Comments list */}
                {comments.length === 0 ? (
                  <p className="text-sm text-slate-600">No comments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((comment) => (
                      <div
                        key={comment.id}
                        className={`glass rounded-xl px-4 py-3 ${comment.is_hidden ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          {comment.author_avatar_url ? (
                            <img src={comment.author_avatar_url} alt="" className="w-5 h-5 rounded-full" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center">
                              <span className="text-[10px] text-purple-400">
                                {(comment.author_display_name || comment.author_account_id)[0].toUpperCase()}
                              </span>
                            </div>
                          )}
                          <Link
                            href={`/profile/${comment.author_account_id}`}
                            className={`text-sm transition-colors font-medium ${comment.author_is_premium ? "diamond-shimmer" : "text-slate-300 hover:text-purple-400"}`}
                          >
                            {(() => {
                              const name = comment.author_display_name || comment.author_account_id;
                              return name.length > 25 ? `${name.slice(0, 12)}...${name.slice(-10)}` : name;
                            })()}
                            {comment.author_is_premium && " ✦"}
                          </Link>
                          <span className="text-xs text-slate-600">
                            {new Date(comment.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          {comment.is_hidden && (
                            <span className="text-xs text-rose-400 ml-auto">hidden</span>
                          )}
                          {(userSlug === comment.author_account_id || isAdmin) && (
                            <button
                              onClick={async () => {
                                if (!confirm("Delete this comment?")) return;
                                try {
                                  await deleteComment(comment.id);
                                  setComments((prev) => prev.filter((c) => c.id !== comment.id));
                                } catch (e) {
                                  console.error("Delete comment failed:", e);
                                }
                              }}
                              className="text-xs text-slate-500 hover:text-rose-400 transition-colors ml-auto"
                              title="Delete comment"
                            >
                              delete
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              onClick={async () => {
                                try {
                                  await moderateComment(comment.id, !comment.is_hidden);
                                  setComments((prev) =>
                                    prev.map((c) =>
                                      c.id === comment.id ? { ...c, is_hidden: !c.is_hidden } : c
                                    )
                                  );
                                } catch (e) {
                                  console.error("Moderate comment failed:", e);
                                }
                              }}
                              className="text-xs text-slate-500 hover:text-rose-400 transition-colors"
                              title={comment.is_hidden ? "Show comment" : "Hide comment"}
                            >
                              {comment.is_hidden ? "show" : "hide"}
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-slate-300 whitespace-pre-wrap">{renderWithMentions(comment.body)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
