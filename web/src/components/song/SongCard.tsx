"use client";

import Link from "next/link";
import type { Song } from "@/types";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { VoteButtons } from "./VoteButtons";

const langFlags: Record<string, string> = {
  ru: "🇷🇺", es: "🇪🇸", zh: "🇨🇳", ko: "🇰🇷", ja: "🇯🇵",
  pt: "🇧🇷", fr: "🇫🇷", de: "🇩🇪", tr: "🇹🇷", vi: "🇻🇳", uk: "🇺🇦",
};

export function SongCard({ song, feedSongs }: { song: Song; feedSongs?: Song[] }) {
  const { currentSong, isPlaying, togglePlay, playFromFeed } = useAudioPlayer();
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
          onClick={() => isActive ? togglePlay(song) : (feedSongs ? playFromFeed(song, feedSongs) : togglePlay(song))}
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
        <div className="flex items-center gap-1 min-w-0">
          <Link href={`/song/${song.uuid}`} className="truncate">
            <h3 className="font-medium text-sm text-slate-200 truncate hover:text-purple-400 transition-colors">
              {song.title}
            </h3>
          </Link>
          {song.created_on_nearfm && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20 font-medium" title="Created on near.fm">
              near.fm
            </span>
          )}
          {song.language_code && song.language_code !== "en" && langFlags[song.language_code] && (
            <span className="shrink-0 text-xs opacity-[0.65]" title={song.language_name || song.language_code}>
              {langFlags[song.language_code]}
            </span>
          )}
        </div>
        <Link
          href={`/profile/${song.uploader_account_id}`}
          className="text-xs text-slate-500 hover:text-slate-300 truncate transition-colors mt-0.5 block"
        >
          {song.uploader_display_name || song.uploader_account_id}
        </Link>

        <div className="flex gap-1 mt-1.5 min-h-[22px] overflow-x-auto scrollbar-hide">
          {song.category_name && (
            <Link
              href={`/?category=${song.category_id}`}
              className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/15 hover:bg-purple-500/20 transition-colors whitespace-nowrap shrink-0"
            >
              {song.category_name}
            </Link>
          )}
          {song.genres?.map((g) => (
            <Link
              key={g.id}
              href={`/genre/${g.slug}`}
              className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/15 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0"
            >
              {g.name}
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/[0.04]">
          <VoteButtons song={song} compact />
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
              {song.play_count}
            </div>
            {song.comment_count > 0 && (
              <div className="flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
                {song.comment_count}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
