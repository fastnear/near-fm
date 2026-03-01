"use client";

import { useEffect, useState, useCallback } from "react";
import type { Song, SortMode, TimePeriod } from "@/types";
import { getSongs } from "@/lib/api";
import { SongCard } from "@/components/song/SongCard";
import { FeedTabs } from "@/components/feed/FeedTabs";
import { FeedFilters } from "@/components/feed/FeedFilters";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";

export default function FeedPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("trending");
  const [period, setPeriod] = useState<TimePeriod>("week");
  const [languageId, setLanguageId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const { setFeedSongs, playFromFeed } = useAudioPlayer();

  const fetchSongs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSongs({
        sort,
        period: sort === "top" ? period : undefined,
        lang: languageId,
        category: categoryId,
        q: searchQuery || undefined,
        page,
        limit: 24,
      });
      setSongs(data.songs);
      setFeedSongs(data.songs);
    } catch (e) {
      console.error("Failed to load songs:", e);
    }
    setLoading(false);
  }, [sort, period, languageId, categoryId, searchQuery, page, setFeedSongs]);

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  // Debounce search
  const [searchDebounce, setSearchDebounce] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchDebounce), 300);
    return () => clearTimeout(timer);
  }, [searchDebounce]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <FeedTabs activeSort={sort} onSortChange={(s) => { setSort(s); setPage(1); }} />
        <FeedFilters
          languageId={languageId}
          categoryId={categoryId}
          period={period}
          showPeriod={sort === "top"}
          searchQuery={searchDebounce}
          onLanguageChange={(id) => { setLanguageId(id); setPage(1); }}
          onCategoryChange={(id) => { setCategoryId(id); setPage(1); }}
          onPeriodChange={(p) => { setPeriod(p); setPage(1); }}
          onSearchChange={setSearchDebounce}
        />
      </div>

      {/* Song grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="glass-card rounded-2xl">
              <div className="aspect-square rounded-t-2xl skeleton" />
              <div className="p-3 space-y-2">
                <div className="h-4 rounded-lg skeleton w-3/4" />
                <div className="h-3 rounded-lg skeleton w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : songs.length === 0 ? (
        <div className="text-center py-24">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 flex items-center justify-center">
            <svg className="w-10 h-10 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <p className="text-slate-400 text-lg font-medium">No songs yet</p>
          <p className="text-slate-600 text-sm mt-2">
            Be the first to upload an AI-generated song!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {songs.map((song) => (
            <SongCard key={song.uuid} song={song} feedSongs={songs} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {songs.length >= 24 && (
        <div className="flex justify-center mt-10 gap-3">
          {page > 1 && (
            <button
              onClick={() => setPage(page - 1)}
              className="btn-ghost px-5 py-2.5 rounded-xl text-sm font-medium"
            >
              Previous
            </button>
          )}
          <span className="flex items-center px-4 text-sm text-slate-500">
            Page {page}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            className="btn-ghost px-5 py-2.5 rounded-xl text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
