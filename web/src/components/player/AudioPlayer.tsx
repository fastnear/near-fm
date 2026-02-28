"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { addBookmark, removeBookmark, getBookmarks } from "@/lib/api";
import { VoteButtons } from "@/components/song/VoteButtons";
import { TipButton } from "@/components/song/TipButton";

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function AudioPlayer() {
  const {
    currentSong,
    isPlaying,
    progress,
    currentTime,
    duration,
    volume,
    radioMode,
    pause,
    resume,
    next,
    previous,
    seek,
    setVolume,
    toggleRadioMode,
    queue,
  } = useAudioPlayer();

  const { accountId, isAuthenticated, signIn, completeSignIn } = useNearWallet();
  const [isUpload, setIsUpload] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    setIsUpload(window.location.hostname.startsWith("upload."));
  }, []);

  // Load bookmark state when song changes
  useEffect(() => {
    if (isAuthenticated && accountId && currentSong) {
      getBookmarks(accountId)
        .then((bookmarks) => {
          setBookmarked(bookmarks.some((b) => b.uuid === currentSong.uuid));
        })
        .catch(() => {});
    } else {
      setBookmarked(false);
    }
  }, [isAuthenticated, accountId, currentSong?.uuid]);

  if (isUpload || !currentSong) return null;

  const songUrl = `/song/${currentSong.uuid}`;

  const handleShare = () => {
    navigator.clipboard.writeText(`${window.location.origin}${songUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBookmark = async () => {
    if (!isAuthenticated || !accountId) {
      if (accountId) { completeSignIn(); } else { signIn(); }
      return;
    }
    try {
      if (bookmarked) {
        await removeBookmark(accountId, currentSong.uuid);
        setBookmarked(false);
      } else {
        await addBookmark(accountId, currentSong.uuid);
        setBookmarked(true);
      }
    } catch (e) { console.error("Bookmark failed:", e); }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 glass-strong">
      {/* Progress bar (clickable) */}
      <div
        className="h-1 bg-white/[0.06] cursor-pointer group relative"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const percent = ((e.clientX - rect.left) / rect.width) * 100;
          seek(percent);
        }}
      >
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all relative"
          style={{ width: `${progress}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-lg shadow-purple-500/30 transition-opacity" />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-2 sm:gap-3">
        {/* Left: Cover + Song info */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <Link href={songUrl} className="flex-shrink-0">
            {currentSong.cover_image_url ? (
              <img
                src={currentSong.cover_image_url}
                alt=""
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg object-cover ring-1 ring-white/[0.06]"
              />
            ) : (
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-gradient-to-br from-purple-800/40 to-cyan-800/40 flex items-center justify-center ring-1 ring-white/[0.06]">
                <svg className="w-5 h-5 text-white/30" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </Link>
          <div className="min-w-0">
            <Link href={songUrl} className="text-sm font-medium text-slate-200 truncate block hover:text-purple-400 transition-colors max-w-[100px] sm:max-w-[180px]">
              {currentSong.title}
            </Link>
            <Link href={`/profile/${currentSong.uploader_account_id}`} className="text-xs text-slate-500 truncate block hover:text-slate-400 transition-colors max-w-[100px] sm:max-w-[180px]">
              {currentSong.uploader_account_id}
            </Link>
          </div>
        </div>

        {/* Center: Playback controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={previous}
            className="hidden sm:block text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.06] transition-all"
            aria-label="Previous"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          <button
            onClick={isPlaying ? pause : resume}
            className="w-9 h-9 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-full flex items-center justify-center hover:scale-105 transition-all shadow-lg shadow-purple-500/20 flex-shrink-0"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            onClick={next}
            className="hidden sm:block text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.06] transition-all"
            aria-label="Next"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          {/* Time */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 tabular-nums ml-1">
            <span>{formatTime(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
          {/* Vote/Tip/Bookmark — hidden on small screens */}
          <div className="hidden md:flex items-center gap-0.5">
            <VoteButtons song={currentSong} compact />
            <TipButton song={currentSong} compact />

            {/* Bookmark */}
            <button
              onClick={handleBookmark}
              className={`p-1.5 rounded-lg transition-all ${
                bookmarked
                  ? "text-purple-400 bg-purple-500/15"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.06]"
              }`}
              title={bookmarked ? "Saved" : "Save"}
            >
              <svg className="w-4 h-4" fill={bookmarked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>

            {/* Share */}
            <button
              onClick={handleShare}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-all"
              title={copied ? "Copied!" : "Share"}
            >
              {copied ? (
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              )}
            </button>
          </div>

          {/* Volume */}
          <div className="hidden lg:flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20"
            />
          </div>

          {/* Radio mode */}
          <button
            onClick={toggleRadioMode}
            className={`hidden sm:flex items-center gap-1 text-xs px-2 py-1.5 rounded-xl transition-all ${
              radioMode
                ? "bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-purple-300 border border-purple-500/20"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
            </svg>
            <span className="hidden lg:inline">Radio</span> {queue.length > 0 && `(${queue.length})`}
          </button>

          {/* Open song page */}
          <Link
            href={songUrl}
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all"
            title="Open song"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
