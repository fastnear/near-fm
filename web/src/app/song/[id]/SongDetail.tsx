"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Song, Category, Language } from "@/types";
import { getSong, updateSong, addBookmark, removeBookmark, getBookmarks, reportSong, moderateSong, getComments, createComment, moderateComment, getCategories, getLanguages } from "@/lib/api";
import { GenrePicker } from "@/components/song/GenrePicker";
import type { Comment } from "@/lib/api";
import { getBalanceRpc } from "@/lib/near/contract";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { VoteButtons } from "@/components/song/VoteButtons";
import { TipButton } from "@/components/song/TipButton";

const ADMIN_ACCOUNTS = (process.env.NEXT_PUBLIC_ADMIN_ACCOUNTS || "").split(",").map(s => s.trim()).filter(Boolean);

export function SongDetail({ uuid }: { uuid: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
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
  const [hasBalance, setHasBalance] = useState<boolean | null>(null);
  const { currentSong, isPlaying, togglePlay } = useAudioPlayer();
  const { accountId, isAuthenticated, signIn, completeSignIn } = useNearWallet();

  useEffect(() => {
    getSong(uuid)
      .then((data) => setSong(data.song))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [uuid]);

  // Poll for validation status updates
  useEffect(() => {
    if (!song || song.is_validated || song.is_hidden) return;
    const interval = setInterval(() => {
      getSong(uuid)
        .then((data) => setSong(data.song))
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [uuid, song?.is_validated, song?.is_hidden]);

  // Load comments
  useEffect(() => {
    if (uuid) {
      getComments(uuid).then(setComments).catch(console.error);
    }
  }, [uuid]);

  // Check virtual balance for commenting
  useEffect(() => {
    if (accountId) {
      getBalanceRpc(accountId)
        .then((bal) => {
          const ONE_NEAR = BigInt("1000000000000000000000000");
          setHasBalance(BigInt(bal) >= ONE_NEAR);
        })
        .catch(() => setHasBalance(null));
    }
  }, [accountId]);

  useEffect(() => {
    getCategories().then(setCategories).catch(console.error);
    getLanguages().then(setLanguages).catch(console.error);
  }, []);

  useEffect(() => {
    if (isAuthenticated && accountId && song) {
      getBookmarks(accountId)
        .then((bookmarks) => {
          setBookmarked(bookmarks.some((b) => b.uuid === song.uuid));
        })
        .catch(() => {});
    }
  }, [isAuthenticated, accountId, song]);

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
  const isAdmin = accountId && ADMIN_ACCOUNTS.includes(accountId);
  const canEdit = accountId && (accountId === song.uploader_account_id || isAdmin);

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
    setEditing(true);
  };

  const saveEdit = async () => {
    setEditSaving(true);
    try {
      const result = await updateSong(song.uuid, {
        title: editForm.title.trim() || undefined,
        description: editForm.description.trim() || undefined,
        lyrics: editForm.lyrics.trim() || undefined,
        ai_model: editForm.ai_model.trim() || undefined,
        genre_ids: editForm.genre_ids,
        language_id: editForm.language_id,
        category_id: editForm.category_id,
      });
      setSong(result.song);
      setEditing(false);
    } catch (e) {
      console.error("Update failed:", e);
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

          {/* Remove cover button */}
          {canEdit && song.cover_image_url && (
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
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={editSaving}
                  className="px-5 py-2 btn-primary rounded-xl text-sm disabled:opacity-50"
                >
                  {editSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
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
              <Link
                href={`/profile/${song.uploader_account_id}`}
                className="text-slate-400 hover:text-purple-400 transition-colors"
              >
                {song.uploader_display_name || song.uploader_account_id}
              </Link>

              <div className="flex flex-wrap gap-1.5 mt-2">
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

              {song.ai_model && (
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
                <TipButton song={song} />

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
                  href={`https://x.com/intent/tweet?text=${encodeURIComponent(`${song.title} — listen on near.fm, decentralized platform for AI-generated music on NEAR\n\n${window.location.href}`)}`}
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

                {/* Bookmark */}
                <button
                  onClick={async () => {
                    if (!isAuthenticated || !accountId) {
                      if (accountId) { completeSignIn(); } else { signIn(); }
                      return;
                    }
                    try {
                      if (bookmarked) {
                        await removeBookmark(accountId, song.uuid);
                        setBookmarked(false);
                      } else {
                        await addBookmark(accountId, song.uuid);
                        setBookmarked(true);
                      }
                    } catch (e) { console.error("Bookmark failed:", e); }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl transition-all ${
                    bookmarked
                      ? "bg-purple-500/15 text-purple-400 border border-purple-500/20"
                      : "btn-ghost"
                  }`}
                >
                  <svg className="w-4 h-4" fill={bookmarked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                  {bookmarked ? "Saved" : "Save"}
                </button>

                {/* Report */}
                <button
                  onClick={() => {
                    if (!isAuthenticated || !accountId) {
                      if (accountId) { completeSignIn(); } else { signIn(); }
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
              </div>

              {/* Description */}
              {song.description && (
                <div className="mt-8">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                    Description
                  </h2>
                  <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {song.description}
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
                {accountId ? (
                  hasBalance === false ? (
                    <div className="mb-4 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl px-4 py-3 text-sm">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <span>
                        You need at least 1 NEAR in your{" "}
                        <Link href="/cabinet" className="text-amber-200 underline hover:text-white transition-colors">virtual balance</Link>
                        {" "}to leave comments.
                      </span>
                    </div>
                  ) : (
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
                            if (!isAuthenticated) {
                              completeSignIn();
                              return;
                            }
                            setCommentSubmitting(true);
                            setCommentError("");
                            try {
                              const newComment = await createComment(uuid, commentText.trim());
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
                          {commentError.includes("1 NEAR") ? (
                            <>
                              You need at least 1 NEAR in your{" "}
                              <Link href="/cabinet" className="underline hover:text-rose-300 transition-colors">virtual balance</Link>
                              {" "}to leave comments.
                            </>
                          ) : commentError.includes("banned") ? (
                            "Your account has been banned."
                          ) : commentError.includes("muted") ? (
                            "Your account has been muted."
                          ) : (
                            commentError
                          )}
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  <p className="text-sm text-slate-500 mb-4">
                    <button onClick={signIn} className="text-purple-400 hover:text-purple-300 transition-colors">Sign in</button> to leave a comment.
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
                            className="text-sm text-slate-300 hover:text-purple-400 transition-colors font-medium"
                          >
                            {(() => {
                              const name = comment.author_display_name || comment.author_account_id;
                              return name.length > 25 ? `${name.slice(0, 12)}...${name.slice(-10)}` : name;
                            })()}
                          </Link>
                          <span className="text-xs text-slate-600">
                            {new Date(comment.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          {comment.is_hidden && (
                            <span className="text-xs text-rose-400 ml-auto">hidden</span>
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
                              className="text-xs text-slate-500 hover:text-rose-400 transition-colors ml-auto"
                              title={comment.is_hidden ? "Show comment" : "Hide comment"}
                            >
                              {comment.is_hidden ? "show" : "hide"}
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-slate-300 whitespace-pre-wrap">{comment.body}</p>
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
