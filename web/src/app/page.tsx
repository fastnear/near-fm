"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Song, SortMode, TimePeriod } from "@/types";
import { getSongs, getRadioPlaylist, getCommunityFeed } from "@/lib/api";
import type { CommunityFeedItem } from "@/lib/api";
import { SongCard } from "@/components/song/SongCard";
import { FeedTabs } from "@/components/feed/FeedTabs";
import { FeedFilters } from "@/components/feed/FeedFilters";
import { CommunityFeedCard } from "@/components/feed/CommunityFeedCard";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { useAuth } from "@/contexts/AuthContext";
import { LandingPage } from "@/components/landing/LandingPage";

function FeedPageInner() {
  const searchParams = useSearchParams();
  const [songs, setSongs] = useState<Song[]>([]);
  const [communityItems, setCommunityItems] = useState<CommunityFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortReady, setSortReady] = useState(false);
  const [sort, setSort] = useState<SortMode>("trending");
  const fetchVersionRef = useRef(0);
  const [period, setPeriod] = useState<TimePeriod>("all");
  const [languageId, setLanguageId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [genreSlug, setGenreSlug] = useState<string | undefined>();
  const [langCode, setLangCode] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const { setFeedSongs, playFromFeed, startRadio, isRadioActive, isPlaying, pause, resume } = useAudioPlayer();
  const { user: authUser } = useAuth();
  const currentUser = authUser?.slug;
  const [radioLoading, setRadioLoading] = useState(false);
  const [exclusionsVersion, setExclusionsVersion] = useState(0);

  // Read initial params from URL
  // Middleware rewrites /genre/:slug → /?genre=slug etc. but Next.js 16
  // doesn't propagate rewritten search params to useSearchParams().
  // So we also parse window.location.pathname directly.
  useEffect(() => {
    const pathname = window.location.pathname;

    // /genre/:slug
    const genreMatch = pathname.match(/^\/genre\/([^/]+)$/);
    if (genreMatch) setGenreSlug(genreMatch[1]);

    // /language/:code
    const langMatch = pathname.match(/^\/language\/([^/]+)$/);
    if (langMatch) setLangCode(langMatch[1]);

    // /trending, /latest, /top
    const sortRoutes: Record<string, SortMode> = {
      "/trending": "trending",
      "/latest": "latest",
      "/top": "top",
      "/following": "following",
      "/community": "community",
    };
    if (sortRoutes[pathname]) {
      setSort(sortRoutes[pathname]);
    } else if (pathname === "/") {
      // Restore last selected feed tab from localStorage
      try {
        const saved = localStorage.getItem("nearfm_feed_sort");
        if (saved && ["trending", "latest", "top", "following", "community"].includes(saved)) {
          setSort(saved as SortMode);
          window.history.replaceState(null, "", `/${saved}`);
        }
      } catch {}
    }

    // Also check searchParams (for direct ?genre=rock etc.)
    const cat = searchParams.get("category");
    if (cat) setCategoryId(Number(cat));
    const sortParam = searchParams.get("sort");
    if (sortParam && ["trending", "latest", "top", "following", "community"].includes(sortParam)) {
      setSort(sortParam as SortMode);
    }
    const genreParam = searchParams.get("genre");
    if (genreParam) setGenreSlug(genreParam);
    const langCodeParam = searchParams.get("lang_code");
    if (langCodeParam) setLangCode(langCodeParam);
    setSortReady(true);
  }, [searchParams]);

  const fetchSongs = useCallback(async () => {
    if (!sortReady) return;
    const version = ++fetchVersionRef.current;
    setLoading(true);
    try {
      if (sort === "community") {
        const data = await getCommunityFeed(page, 24);
        if (version !== fetchVersionRef.current) return;
        setCommunityItems(data.items);
        setSongs([]);
        setFeedSongs([]);
      } else {
        const isFollowing = sort === "following";
        const data = await getSongs({
          sort,
          period: sort === "top" ? period : undefined,
          lang: isFollowing ? undefined : languageId,
          category: isFollowing ? undefined : categoryId,
          genre: isFollowing ? undefined : genreSlug,
          lang_code: isFollowing ? undefined : langCode,
          q: isFollowing ? undefined : (searchQuery || undefined),
          page,
          limit: 24,
        });
        // Ignore stale responses
        if (version !== fetchVersionRef.current) return;
        setSongs(data.songs);
        setCommunityItems([]);
        setFeedSongs(data.songs);
      }
    } catch (e) {
      console.error("Failed to load songs:", e);
    }
    if (version === fetchVersionRef.current) setLoading(false);
  }, [sortReady, sort, period, languageId, categoryId, genreSlug, langCode, searchQuery, page, setFeedSongs, exclusionsVersion]);

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
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (isRadioActive && isPlaying) {
                pause();
                return;
              }
              if (isRadioActive && !isPlaying) {
                resume();
                return;
              }
              setRadioLoading(true);
              try {
                const songs = await getRadioPlaylist();
                if (songs.length > 0) startRadio(songs);
              } catch (e) {
                console.error("Failed to load radio:", e);
              }
              setRadioLoading(false);
            }}
            disabled={radioLoading}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border transition-all disabled:opacity-50 ${
              isRadioActive
                ? "bg-gradient-to-r from-purple-600/30 to-pink-600/30 text-white border-purple-500/30 shadow-lg shadow-purple-500/10"
                : "bg-gradient-to-r from-purple-600/20 to-pink-600/20 text-white border-purple-500/20 hover:from-purple-600/30 hover:to-pink-600/30"
            }`}
          >
            {radioLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : isRadioActive && isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            <span className="hidden sm:inline">AI Radio</span>
          </button>
          <FeedTabs activeSort={sort} onSortChange={(s) => { setSort(s); setPage(1); setGenreSlug(undefined); setLangCode(undefined); }} isAuthenticated={!!currentUser} />
        </div>
        {sort !== "following" && sort !== "community" && (
          <FeedFilters
            languageId={languageId}
            categoryId={categoryId}
            genreSlug={genreSlug}
            period={period}
            showPeriod={sort === "top"}
            searchQuery={searchDebounce}
            onLanguageChange={(id) => { setLanguageId(id); setPage(1); }}
            onCategoryChange={(id) => { setCategoryId(id); setPage(1); }}
            onGenreChange={(slug) => { setGenreSlug(slug); setPage(1); }}
            onPeriodChange={(p) => { setPeriod(p); setPage(1); }}
            onSearchChange={setSearchDebounce}
            onExclusionsChange={() => setExclusionsVersion((v) => v + 1)}
          />
        )}
      </div>

      {/* Content */}
      {loading ? (
        sort === "community" ? (
          <div className="max-w-2xl mx-auto space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full skeleton" />
                  <div className="h-3 skeleton rounded w-28" />
                </div>
                <div className="h-4 skeleton rounded w-full" />
                <div className="h-4 skeleton rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : (
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
        )
      ) : sort === "community" ? (
        communityItems.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 flex items-center justify-center">
              <svg className="w-10 h-10 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-slate-400 text-lg font-medium">No community posts yet</p>
            <p className="text-slate-600 text-sm mt-2">Blog posts and song comments will appear here.</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {communityItems.map((item) => (
              <CommunityFeedCard key={`${item.item_type}-${item.id}`} item={item} />
            ))}
          </div>
        )
      ) : songs.length === 0 ? (
        <div className="text-center py-24">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 flex items-center justify-center">
            <svg className="w-10 h-10 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <p className="text-slate-400 text-lg font-medium">
            {sort === "following" ? "No songs from people you follow" : "No songs yet"}
          </p>
          <p className="text-slate-600 text-sm mt-2">
            {sort === "following"
              ? "Start following artists to see their songs here!"
              : "Be the first to upload an AI-generated song!"}
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
      {(sort === "community" ? communityItems.length >= 24 : songs.length >= 24) && (
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

function FeedPageWrapper() {
  const [showLanding, setShowLanding] = useState<boolean | null>(null);

  useEffect(() => {
    const isRoot = window.location.pathname === "/";
    const visited = localStorage.getItem("nearfm_visited");
    setShowLanding(isRoot && !visited);

    // Any nav click sets nearfm_visited and dispatches this event
    const handleDismiss = () => setShowLanding(false);
    window.addEventListener("nearfm_dismiss_landing", handleDismiss);
    return () => window.removeEventListener("nearfm_dismiss_landing", handleDismiss);
  }, []);

  if (showLanding === null) return null;

  if (showLanding) {
    return (
      <LandingPage
        onOpenApp={() => setShowLanding(false)}
      />
    );
  }

  return <FeedPageInner />;
}

export default function FeedPage() {
  return (
    <Suspense>
      <FeedPageWrapper />
    </Suspense>
  );
}
