"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { VoteButtons } from "@/components/song/VoteButtons";
import { TipButton } from "@/components/song/TipButton";
import { AudioVisualizer } from "./AudioVisualizer";

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
    playMode,
    setPlayMode,
    pause,
    resume,
    next,
    previous,
    seek,
    setVolume,
    queue,
  } = useAudioPlayer();

  const { user, isAuthenticated } = useAuth();
  const { accountId } = useNearWallet();
  const userSlug = user?.slug;
  const [copied, setCopied] = useState(false);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const dragProgressRef = useRef(0);

  const getPercentFromEvent = useCallback((clientX: number) => {
    const bar = seekBarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handleSeekStart = useCallback((clientX: number) => {
    const pct = getPercentFromEvent(clientX);
    setIsDragging(true);
    setDragProgress(pct);
    dragProgressRef.current = pct;
  }, [getPercentFromEvent]);

  // Global mouse/touch listeners for drag — prevents losing drag when cursor leaves the bar
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const pct = getPercentFromEvent(e.clientX);
      setDragProgress(pct);
      dragProgressRef.current = pct;
    };
    const onTouchMove = (e: TouchEvent) => {
      const pct = getPercentFromEvent(e.touches[0].clientX);
      setDragProgress(pct);
      dragProgressRef.current = pct;
    };
    const onEnd = () => {
      seek(dragProgressRef.current);
      setIsDragging(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onTouchMove);
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [isDragging, getPercentFromEvent, seek]);

  if (!currentSong) return null;

  const songUrl = `/song/${currentSong.uuid}`;

  const handleShare = () => {
    navigator.clipboard.writeText(`${window.location.origin}${songUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 glass-strong">
      {/* Seekable area: visualizer + progress bar (draggable) */}
      <div
        ref={seekBarRef}
        className="cursor-pointer py-1 sm:py-0 group touch-none"
        onMouseDown={(e) => { e.preventDefault(); handleSeekStart(e.clientX); }}
        onTouchStart={(e) => handleSeekStart(e.touches[0].clientX)}
        onClick={(e) => {
          if (!isDragging) {
            const pct = getPercentFromEvent(e.clientX);
            seek(pct);
          }
        }}
      >
        {/* Audio visualizer — desktop only */}
        {isPlaying && <AudioVisualizer />}

        {/* Progress bar */}
        <div className="h-1 bg-white/[0.06] relative">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 relative"
            style={{ width: `${isDragging ? dragProgress : progress}%`, transition: isDragging ? "none" : "width 0.2s" }}
          >
            <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg shadow-purple-500/30 transition-opacity ${isDragging ? "opacity-100 scale-125" : "opacity-0 group-hover:opacity-100"}`} />
          </div>
        </div>
        {isDragging && (
          <div
            className="absolute top-[-28px] bg-black/80 text-white text-xs px-2 py-1 rounded pointer-events-none"
            style={{ left: `${dragProgress}%`, transform: "translateX(-50%)" }}
          >
            {formatTime((dragProgress / 100) * duration)}
          </div>
        )}
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
              {currentSong.uploader_display_name || currentSong.uploader_account_id}
            </Link>
          </div>
        </div>

        {/* Center: Playback controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={previous}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.06] transition-all"
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
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.06] transition-all"
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

            {/* Share */}
            <button
              onClick={handleShare}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-all"
              title={copied ? "Copied!" : "Share"}
            >
              {copied ? (
                <svg className="w-4 h-4 text-[#00ec97]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

          {/* Play mode toggle: radio → repeat → none */}
          <button
            onClick={() => {
              const modes: Array<"radio" | "repeat" | "none"> = ["radio", "repeat", "none"];
              const idx = modes.indexOf(playMode);
              setPlayMode(modes[(idx + 1) % 3]);
            }}
            className={`hidden sm:flex items-center gap-1 text-xs px-2 py-1.5 rounded-xl transition-all ${
              playMode !== "none"
                ? "bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-purple-300 border border-purple-500/20"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
            }`}
            title={playMode === "radio" ? "Radio: auto-play next" : playMode === "repeat" ? "Repeat current song" : "Stop after song ends"}
          >
            {playMode === "radio" ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
            ) : playMode === "repeat" ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            )}
            <span className="hidden lg:inline">
              {playMode === "radio" ? "Radio" : playMode === "repeat" ? "Repeat" : "Off"}
            </span>
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
