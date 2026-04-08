"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getPlaylist, getPlaylistSongs } from "@/lib/api";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import type { Song, Playlist } from "@/types";

export default function PlaylistPage() {
  const params = useParams();
  const uuid = params.id as string;
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [ownerAccountId, setOwnerAccountId] = useState("");
  const [ownerDisplayName, setOwnerDisplayName] = useState<string | null>(null);
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { currentSong, isPlaying, togglePlay, playFromFeed, setQueue, next, previous } = useAudioPlayer();

  useEffect(() => {
    if (!uuid) return;
    setLoading(true);
    Promise.all([getPlaylist(uuid), getPlaylistSongs(uuid)])
      .then(([data, songsData]) => {
        setPlaylist(data.playlist);
        setOwnerAccountId(data.owner_account_id);
        setOwnerDisplayName(data.owner_display_name);
        setOwnerAvatarUrl(data.owner_avatar_url);
        setSongs(songsData);
      })
      .catch((e) => setError(e.message || "Playlist not found"))
      .finally(() => setLoading(false));
  }, [uuid]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-full md:w-64 aspect-square rounded-2xl skeleton" />
          <div className="flex-1 space-y-4">
            <div className="h-8 rounded-xl skeleton w-2/3" />
            <div className="h-4 rounded-lg skeleton w-1/3" />
            <div className="h-20 rounded-xl skeleton" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-slate-500 text-lg">{error || "Playlist not found"}</p>
      </div>
    );
  }

  const feedImage = playlist.cover_image_url || songs[0]?.cover_image_url || ownerAvatarUrl;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex flex-col md:flex-row gap-8 mb-8">
        {/* Cover */}
        <div className="w-full md:w-64 flex-shrink-0">
          <div className="aspect-square rounded-2xl overflow-hidden ring-1 ring-white/[0.06] shadow-2xl">
            {feedImage ? (
              <img src={feedImage} alt={playlist.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-cyan-900/50 flex items-center justify-center">
                <svg className="w-20 h-20 text-white/15" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Playlist</p>
          <h1 className="text-3xl font-bold text-white mb-2">{playlist.name}</h1>

          <div className="flex items-center gap-2 mb-3">
            {ownerAvatarUrl && (
              <img src={ownerAvatarUrl} alt="" className="w-5 h-5 rounded-full" />
            )}
            <Link
              href={`/profile/${ownerAccountId}`}
              className="text-sm text-slate-400 hover:text-purple-400 transition-colors"
            >
              {ownerDisplayName || ownerAccountId}
            </Link>
            <span className="text-xs text-slate-600">&middot; {songs.length} song{songs.length !== 1 ? "s" : ""}</span>
          </div>

          {playlist.description && (
            <p className="text-sm text-slate-400 mb-4 whitespace-pre-wrap">{playlist.description}</p>
          )}

          {songs.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const isPlayingFromThisPlaylist = currentSong && songs.some(s => s.uuid === currentSong.uuid);
                  if (isPlayingFromThisPlaylist && isPlaying) {
                    togglePlay(currentSong!);
                  } else if (isPlayingFromThisPlaylist) {
                    togglePlay(currentSong!);
                  } else {
                    playFromFeed(songs[0], songs);
                  }
                }}
                className="w-12 h-12 rounded-full bg-purple-500 hover:bg-purple-400 transition flex items-center justify-center shadow-lg shadow-purple-500/25"
              >
                {currentSong && songs.some(s => s.uuid === currentSong.uuid) && isPlaying ? (
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Song list */}
      {songs.length === 0 ? (
        <p className="text-center text-slate-500 py-12">This playlist is empty.</p>
      ) : (
        <div className="space-y-1">
          {songs.map((song, i) => {
            const isActive = currentSong?.uuid === song.uuid;
            return (
              <div
                key={song.uuid}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${
                  isActive ? "bg-purple-500/10" : "hover:bg-white/[0.04]"
                }`}
              >
                <button
                  onClick={() => {
                    const isActive = currentSong?.uuid === song.uuid;
                    if (isActive) {
                      togglePlay(song);
                    } else {
                      playFromFeed(song, songs);
                    }
                  }}
                  className="w-8 h-8 flex items-center justify-center shrink-0 text-slate-400 hover:text-white transition"
                >
                  {isActive && isPlaying ? (
                    <svg className="w-4 h-4 text-purple-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                    </svg>
                  ) : (
                    <span className="text-xs text-slate-600">{i + 1}</span>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (currentSong?.uuid === song.uuid) togglePlay(song);
                    else playFromFeed(song, songs);
                  }}
                  className="w-10 h-10 rounded overflow-hidden shrink-0 ring-1 ring-white/[0.06] relative group cursor-pointer"
                >
                  {song.cover_image_url ? (
                    <img src={song.cover_image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-cyan-900/50" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                    {isActive && isPlaying ? (
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
                    ) : (
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    )}
                  </div>
                </button>
                <div className="flex-1 min-w-0">
                  <Link href={`/song/${song.uuid}`} className="text-sm text-white hover:text-purple-400 transition-colors truncate block">
                    {song.title}
                  </Link>
                  <p className="text-xs text-slate-500 truncate">
                    {song.uploader_display_name || song.uploader_account_id}
                  </p>
                </div>
                {song.audio_duration_seconds && (
                  <span className="text-xs text-slate-600 shrink-0">
                    {Math.floor(song.audio_duration_seconds / 60)}:{String(song.audio_duration_seconds % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
