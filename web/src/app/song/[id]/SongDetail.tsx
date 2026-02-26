"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Song } from "@/types";
import { getSong, addBookmark, removeBookmark, reportSong } from "@/lib/api";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { VoteButtons } from "@/components/song/VoteButtons";
import { TipButton } from "@/components/song/TipButton";

export function SongDetail({ uuid }: { uuid: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const { currentSong, isPlaying, togglePlay } = useAudioPlayer();
  const { accountId, signIn } = useNearWallet();

  useEffect(() => {
    getSong(uuid)
      .then((data) => setSong(data.song))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [uuid]);

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

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Cover */}
        <div className="relative w-full md:w-80 flex-shrink-0">
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

          {/* Play button */}
          <button
            onClick={() => togglePlay(song)}
            className={`absolute bottom-4 right-4 w-14 h-14 rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-all ${
              isActive && isPlaying
                ? "bg-gradient-to-r from-purple-500 to-cyan-500 animate-pulse-glow"
                : "bg-gradient-to-r from-purple-500 to-purple-600 shadow-purple-500/30"
            }`}
          >
            {isActive && isPlaying ? (
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-white mb-2">{song.title}</h1>
          <Link
            href={`/profile/${song.uploader_account_id}`}
            className="text-slate-400 hover:text-purple-400 transition-colors"
          >
            {song.uploader_display_name || song.uploader_account_id}
          </Link>

          {song.ai_model && (
            <p className="text-xs text-slate-600 mt-1.5 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Generated with {song.ai_model}
            </p>
          )}

          {/* Actions */}
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
                if (!accountId) { signIn(); return; }
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
                if (!accountId) { signIn(); return; }
                setShowReportForm(!showReportForm);
              }}
              className="btn-ghost px-3 py-1.5 text-sm rounded-xl flex items-center gap-1.5 hover:!text-rose-400 hover:!border-rose-500/20 hover:!bg-rose-500/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
              Report
            </button>
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
            <p className="mt-3 text-sm text-emerald-400 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Report submitted. Thank you.
            </p>
          )}

          {/* Stats */}
          <div className="flex gap-4 mt-5 text-sm">
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
        </div>
      </div>
    </div>
  );
}
