"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { Category, Genre, Language, TimePeriod } from "@/types";
import { getCategories, getGenres, getLanguages, getFeedPreferences, updateFeedPreferences } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  languageId: number | undefined;
  categoryId: number | undefined;
  genreSlug: string | undefined;
  period: TimePeriod | undefined;
  showPeriod: boolean;
  searchQuery: string;
  onLanguageChange: (id: number | undefined) => void;
  onCategoryChange: (id: number | undefined) => void;
  onGenreChange: (slug: string | undefined) => void;
  onPeriodChange: (period: TimePeriod) => void;
  onSearchChange: (q: string) => void;
  onExclusionsChange?: () => void;
}

export function FeedFilters({
  languageId,
  categoryId,
  genreSlug,
  period,
  showPeriod,
  searchQuery,
  onLanguageChange,
  onCategoryChange,
  onGenreChange,
  onPeriodChange,
  onSearchChange,
  onExclusionsChange,
}: Props) {
  const { user } = useAuth();
  const accountId = user?.slug;
  const [categories, setCategories] = useState<Category[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const customizeRef = useRef<HTMLDivElement>(null);

  // Exclusion preferences (logged-in only)
  const [excludedGenres, setExcludedGenres] = useState<Set<number>>(new Set());
  const [excludedLanguages, setExcludedLanguages] = useState<Set<number>>(new Set());
  const [excludedCategories, setExcludedCategories] = useState<Set<number>>(new Set());
  const [hideNoCover, setHideNoCover] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    getCategories().then(setCategories).catch(console.error);
    getGenres().then(setGenres).catch(console.error);
    getLanguages().then(setLanguages).catch(console.error);
  }, []);

  // Load feed preferences for logged-in users
  useEffect(() => {
    if (!accountId) return;
    getFeedPreferences(accountId)
      .then((prefs) => {
        setExcludedGenres(new Set(prefs.excluded_genres));
        setExcludedLanguages(new Set(prefs.excluded_languages));
        setExcludedCategories(new Set(prefs.excluded_categories));
        setHideNoCover(prefs.hide_no_cover);
        setPrefsLoaded(true);
      })
      .catch(console.error);
  }, [accountId]);

  // Click-outside to close Filters
  useEffect(() => {
    if (!filtersOpen) return;
    const handler = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filtersOpen]);

  // Click-outside to close Customize
  useEffect(() => {
    if (!customizeOpen) return;
    const handler = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) {
        setCustomizeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [customizeOpen]);

  const savePrefs = useCallback(
    async (eg: Set<number>, el: Set<number>, ec: Set<number>, noCover: boolean) => {
      if (!accountId) return;
      try {
        await updateFeedPreferences(accountId, {
          excluded_genres: [...eg],
          excluded_languages: [...el],
          excluded_categories: [...ec],
          hide_no_cover: noCover,
        });
        onExclusionsChange?.();
      } catch (e) {
        console.error("Failed to save preferences:", e);
      }
    },
    [accountId, onExclusionsChange]
  );

  const toggleExclGenre = (id: number) => {
    const next = new Set(excludedGenres);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcludedGenres(next);
    savePrefs(next, excludedLanguages, excludedCategories, hideNoCover);
  };

  const toggleExclLanguage = (id: number) => {
    const next = new Set(excludedLanguages);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcludedLanguages(next);
    savePrefs(excludedGenres, next, excludedCategories, hideNoCover);
  };

  const toggleExclCategory = (id: number) => {
    const next = new Set(excludedCategories);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcludedCategories(next);
    savePrefs(excludedGenres, excludedLanguages, next, hideNoCover);
  };

  const toggleNoCover = () => {
    const next = !hideNoCover;
    setHideNoCover(next);
    savePrefs(excludedGenres, excludedLanguages, excludedCategories, next);
  };

  const filtersActiveCount =
    (languageId ? 1 : 0) +
    (categoryId ? 1 : 0) +
    (genreSlug ? 1 : 0);

  const exclusionCount =
    excludedGenres.size + excludedLanguages.size + excludedCategories.size + (hideNoCover ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search songs..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="rounded-xl pl-9 pr-3 py-2 text-sm w-52 border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 focus:outline-none transition-all hover:border-white/[0.15]"
        />
      </div>

      {/* Period (only for Top) */}
      {showPeriod && (
        <select
          value={period ?? "all"}
          onChange={(e) => onPeriodChange(e.target.value as TimePeriod)}
          className="rounded-xl px-3 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 focus:outline-none transition-all appearance-none cursor-pointer hover:border-white/[0.15]"
        >
          <option value="day">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
      )}

      {/* Filters button (NOT logged in) — quick category/language/genre selection */}
      {!accountId && (
        <div className="relative" ref={filtersRef}>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm border transition-all cursor-pointer ${
              filtersActiveCount > 0 || filtersOpen
                ? "border-purple-500/40 bg-purple-500/10 text-white"
                : "border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-white/[0.15]"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {filtersActiveCount > 0 && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-xs font-bold">
                {filtersActiveCount}
              </span>
            )}
          </button>

          {filtersOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-2xl p-4 border border-white/[0.1] shadow-xl shadow-black/60 bg-[#0f0a1f] backdrop-blur-xl">
              {filtersActiveCount > 0 && (
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/[0.06]">
                  <span className="text-xs text-slate-400">{filtersActiveCount} active filter{filtersActiveCount > 1 ? "s" : ""}</span>
                  <button
                    onClick={() => {
                      onLanguageChange(undefined);
                      onCategoryChange(undefined);
                      onGenreChange(undefined);
                    }}
                    className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* Languages */}
              <div className="mb-4">
                <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Language</p>
                <div className="flex flex-wrap gap-1.5">
                  {languages.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => onLanguageChange(languageId === l.id ? undefined : l.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                        languageId === l.id
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-slate-300"
                      }`}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Categories */}
              <div className="mb-4">
                <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Category</p>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onCategoryChange(categoryId === c.id ? undefined : c.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                        categoryId === c.id
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-slate-300"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Genres */}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Genre</p>
                <div className="flex flex-wrap gap-1.5">
                  {genres.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => onGenreChange(genreSlug === g.slug ? undefined : g.slug)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                        genreSlug === g.slug
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-slate-300"
                      }`}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Customize button (logged-in) — feed exclusion preferences */}
      {accountId && (
        <div className="relative" ref={customizeRef}>
          <button
            onClick={() => setCustomizeOpen((v) => !v)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm border transition-all cursor-pointer ${
              exclusionCount > 0 || customizeOpen
                ? "border-purple-500/40 bg-purple-500/10 text-white"
                : "border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-white/[0.15]"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Customize
            {exclusionCount > 0 && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-xs font-bold">
                {exclusionCount}
              </span>
            )}
          </button>

          {customizeOpen && prefsLoaded && (
            <div className="absolute right-0 top-full mt-2 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-2xl p-4 border border-white/[0.1] shadow-xl shadow-black/60 bg-[#0f0a1f] backdrop-blur-xl">
              <p className="text-xs text-slate-500 mb-3">Click to hide/show content in your feed. Changes save automatically.</p>

              {/* Hide no cover toggle */}
              <button
                onClick={toggleNoCover}
                className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors mb-4"
              >
                <div className={`w-8 h-5 rounded-full transition-colors relative shrink-0 ${hideNoCover ? "bg-purple-500" : "bg-white/[0.08]"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${hideNoCover ? "left-3.5" : "left-0.5"}`} />
                </div>
                <span className="text-xs text-slate-300">Hide songs without cover</span>
              </button>

              {/* Genres */}
              <div className="mb-3">
                <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Genres</p>
                <div className="flex flex-wrap gap-1.5">
                  {genres.map((g) => {
                    const excluded = excludedGenres.has(g.id);
                    return (
                      <button
                        key={g.id}
                        onClick={() => toggleExclGenre(g.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                          excluded
                            ? "bg-white/[0.02] text-slate-600 border-white/[0.04] hover:border-white/[0.08]"
                            : "bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/15"
                        }`}
                      >
                        {excluded && (
                          <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Languages */}
              <div className="mb-3">
                <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Languages</p>
                <div className="flex flex-wrap gap-1.5">
                  {languages.map((l) => {
                    const excluded = excludedLanguages.has(l.id);
                    return (
                      <button
                        key={l.id}
                        onClick={() => toggleExclLanguage(l.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                          excluded
                            ? "bg-white/[0.02] text-slate-600 border-white/[0.04] hover:border-white/[0.08]"
                            : "bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/15"
                        }`}
                      >
                        {excluded && (
                          <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Categories */}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Categories</p>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => {
                    const excluded = excludedCategories.has(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleExclCategory(c.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                          excluded
                            ? "bg-white/[0.02] text-slate-600 border-white/[0.04] hover:border-white/[0.08]"
                            : "bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/15"
                        }`}
                      >
                        {excluded && (
                          <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Reset */}
              {exclusionCount > 0 && (
                <div className="mt-4 pt-3 border-t border-white/[0.06]">
                  <button
                    onClick={() => {
                      setExcludedGenres(new Set());
                      setExcludedLanguages(new Set());
                      setExcludedCategories(new Set());
                      setHideNoCover(false);
                      savePrefs(new Set(), new Set(), new Set(), false);
                    }}
                    className="w-full text-center text-xs text-slate-500 hover:text-slate-300 py-2 rounded-lg hover:bg-white/[0.04] transition-colors"
                  >
                    Reset all preferences
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
