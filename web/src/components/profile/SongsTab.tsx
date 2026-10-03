"use client";

import { useEffect, useState } from "react";
import { SongCard } from "@/components/song/SongCard";
import { getUserSongs } from "@/lib/api";
import type { Song } from "@/types";

export function SongsTab({
  songs,
  slug,
  total,
}: {
  songs: Song[];
  slug?: string;
  total?: number;
}) {
  // `songs` is the first page (from the profile payload); further pages are appended here.
  const [list, setList] = useState<Song[]>(songs);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Reset when the parent reloads with a fresh first page (e.g. different profile).
  useEffect(() => {
    setList(songs);
    setPage(1);
  }, [songs, slug]);

  const totalCount = total ?? songs.length;
  const hasMore = !!slug && list.length < totalCount;

  const loadMore = async () => {
    if (!slug || loading) return;
    setLoading(true);
    try {
      const next = page + 1;
      const data = await getUserSongs(slug, next);
      setList((prev) => {
        // De-dupe defensively in case a song was added/removed between page loads.
        const seen = new Set(prev.map((s) => s.uuid));
        return [...prev, ...data.songs.filter((s) => !seen.has(s.uuid))];
      });
      setPage(next);
    } catch (e) {
      console.error("Failed to load more songs:", e);
    } finally {
      setLoading(false);
    }
  };

  if (list.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-500 text-lg">No songs uploaded yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {list.map((song) => (
          <SongCard key={song.uuid} song={song} />
        ))}
      </div>
      {hasMore && (
        <div className="flex justify-center mt-8">
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-6 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-sm text-slate-200 font-medium transition disabled:opacity-50"
          >
            {loading ? "Loading…" : `Load more (${list.length} / ${totalCount})`}
          </button>
        </div>
      )}
    </>
  );
}
