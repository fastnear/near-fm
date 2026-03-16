"use client";

import { SongCard } from "@/components/song/SongCard";
import type { Song } from "@/types";

export function SongsTab({ songs }: { songs: Song[] }) {
  if (songs.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-500 text-lg">No songs uploaded yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {songs.map((song) => (
        <SongCard key={song.uuid} song={song} />
      ))}
    </div>
  );
}
