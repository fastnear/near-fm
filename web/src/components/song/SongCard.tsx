"use client";

import Link from "next/link";
import type { Song } from "@/types";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { VoteButtons } from "./VoteButtons";

export function SongCard({ song }: { song: Song }) {
  const { currentSong, isPlaying, togglePlay } = useAudioPlayer();
  const isActive = currentSong?.uuid === song.uuid;

  return (
    <div
      className={`group glass-card card-shine rounded-2xl transition-all duration-300 hover:scale-[1.02] ${
        isActive ? "glow-purple ring-1 ring-purple-500/30" : "hover:border-white/[0.12]"
      }`}
    >
      {/* Cover image */}
      <div className="relative aspect-square overflow-hidden rounded-t-2xl">
        {song.cover_image_url ? (
          <img
            src={song.cover_image_url}
            alt={song.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-cyan-900/50 flex items-center justify-center">
            <svg className="w-12 h-12 text-white/20" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}

        {/* Play button overlay */}
        <button
          onClick={() => togglePlay(song)}
          className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all duration-300"
        >
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${
              isActive && isPlaying
                ? "opacity-100 scale-100 bg-gradient-to-r from-purple-500 to-cyan-500 animate-pulse-glow"
                : "opacity-0 group-hover:opacity-100 group-hover:scale-100 scale-75 bg-gradient-to-r from-purple-500 to-purple-600"
            }`}
          >
            {isActive && isPlaying ? (
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </div>
        </button>
      </div>

      {/* Info */}
      <div className="p-3">
        <Link href={`/song/${song.uuid}`}>
          <h3 className="font-medium text-sm text-slate-200 truncate hover:text-purple-400 transition-colors">
            {song.title}
          </h3>
        </Link>
        <Link
          href={`/profile/${song.uploader_account_id}`}
          className="text-xs text-slate-500 hover:text-slate-300 truncate block mt-0.5 transition-colors"
        >
          {song.uploader_display_name || song.uploader_account_id}
        </Link>

        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/[0.04]">
          <VoteButtons song={song} compact />
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            </svg>
            {song.play_count}
          </div>
        </div>
      </div>
    </div>
  );
}
