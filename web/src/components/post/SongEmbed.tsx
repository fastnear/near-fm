"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSong } from "@/lib/api";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import type { Song } from "@/types";

function formatDuration(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Lightweight embed using pre-fetched data — fetches full song only on play */
export function SongEmbedCompact({ uuid, title, coverImageUrl }: { uuid: string; title: string; coverImageUrl: string | null }) {
  const [song, setSong] = useState<Song | null>(null);
  const { currentSong, isPlaying, togglePlay } = useAudioPlayer();

  const isActive = currentSong?.uuid === uuid;
  const isCurrentlyPlaying = isActive && isPlaying;

  const handlePlay = async () => {
    if (song) {
      togglePlay(song);
      return;
    }
    try {
      const res = await getSong(uuid);
      setSong(res.song);
      togglePlay(res.song);
    } catch {}
  };

  return (
    <div
      className={`my-2 flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
        isActive
          ? "bg-purple-500/[0.07] border-purple-500/25"
          : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1]"
      }`}
    >
      <button
        onClick={handlePlay}
        className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 group/play"
      >
        {coverImageUrl ? (
          <img src={coverImageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-900/60 to-cyan-900/60 flex items-center justify-center">
            <svg className="w-4 h-4 text-white/30" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}
        {isCurrentlyPlaying ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/play:opacity-0 transition-opacity">
            <div className="flex items-end gap-[2px] h-3">
              <span className="w-[3px] bg-purple-400 rounded-full animate-[equalizer_0.6s_ease-in-out_infinite]" />
              <span className="w-[3px] bg-purple-400 rounded-full animate-[equalizer_0.6s_ease-in-out_infinite_0.2s]" />
              <span className="w-[3px] bg-purple-400 rounded-full animate-[equalizer_0.6s_ease-in-out_infinite_0.4s]" />
            </div>
          </div>
        ) : null}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/play:opacity-100 transition-opacity">
          {isCurrentlyPlaying ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </div>
      </button>
      <div className="flex-1 min-w-0">
        <Link
          href={`/song/${uuid}`}
          className="text-[13px] font-medium text-slate-200 hover:text-white transition-colors truncate block"
        >
          {title}
        </Link>
      </div>
    </div>
  );
}

export function SongEmbed({ uuid }: { uuid: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState(false);
  const { currentSong, isPlaying, togglePlay } = useAudioPlayer();

  const isActive = currentSong?.uuid === uuid;
  const isCurrentlyPlaying = isActive && isPlaying;

  useEffect(() => {
    getSong(uuid)
      .then((res) => setSong(res.song))
      .catch(() => setError(true));
  }, [uuid]);

  if (error) {
    return (
      <div className="my-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[12px] text-slate-600">
        Song not found
      </div>
    );
  }

  if (!song) {
    return (
      <div className="my-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg skeleton" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 skeleton rounded w-32" />
            <div className="h-2.5 skeleton rounded w-20" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`my-2 flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
        isActive
          ? "bg-purple-500/[0.07] border-purple-500/25"
          : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1]"
      }`}
    >
      {/* Cover + play button */}
      <button
        onClick={() => togglePlay(song)}
        className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 group/play"
      >
        {song.cover_image_url ? (
          <img src={song.cover_image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-900/60 to-cyan-900/60 flex items-center justify-center">
            <svg className="w-4 h-4 text-white/30" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}
        {isCurrentlyPlaying ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/play:opacity-0 transition-opacity">
            <div className="flex items-end gap-[2px] h-3">
              <span className="w-[3px] bg-purple-400 rounded-full animate-[equalizer_0.6s_ease-in-out_infinite]" />
              <span className="w-[3px] bg-purple-400 rounded-full animate-[equalizer_0.6s_ease-in-out_infinite_0.2s]" />
              <span className="w-[3px] bg-purple-400 rounded-full animate-[equalizer_0.6s_ease-in-out_infinite_0.4s]" />
            </div>
          </div>
        ) : null}
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/play:opacity-100 transition-opacity">
          {isCurrentlyPlaying ? (
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </div>
      </button>

      {/* Song info */}
      <div className="flex-1 min-w-0">
        <Link
          href={`/song/${song.uuid}`}
          className="text-[13px] font-medium text-slate-200 hover:text-white transition-colors truncate block"
        >
          {song.title}
        </Link>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Link href={`/profile/${song.uploader_account_id}`} className="hover:text-slate-400 transition-colors truncate">
            {song.uploader_display_name || song.uploader_account_id}
          </Link>
          {song.audio_duration_seconds && (
            <span>{formatDuration(song.audio_duration_seconds)}</span>
          )}
        </div>
      </div>

      {/* Play count */}
      <div className="flex items-center gap-1 text-[11px] text-slate-600 shrink-0">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        {song.play_count}
      </div>
    </div>
  );
}
