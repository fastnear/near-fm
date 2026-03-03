"use client";

import { useEffect, useState, useRef } from "react";
import type { Category, Genre, Language, TimePeriod } from "@/types";
import { getCategories, getGenres, getLanguages } from "@/lib/api";

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
}: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCategories().then(setCategories).catch(console.error);
    getGenres().then(setGenres).catch(console.error);
    getLanguages().then(setLanguages).catch(console.error);
  }, []);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeCount =
    (languageId ? 1 : 0) +
    (categoryId ? 1 : 0) +
    (genreSlug ? 1 : 0);

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

      {/* Filters button + popup */}
      <div className="relative" ref={popupRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm border transition-all cursor-pointer ${
            activeCount > 0 || open
              ? "border-purple-500/40 bg-purple-500/10 text-white"
              : "border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-white/[0.15]"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500 text-white text-xs font-bold">
              {activeCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-2xl p-4 border border-white/[0.1] shadow-xl shadow-black/60 bg-[#0f0a1f] backdrop-blur-xl">
            {/* Active filters summary */}
            {activeCount > 0 && (
              <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/[0.06]">
                <span className="text-xs text-slate-400">{activeCount} active filter{activeCount > 1 ? "s" : ""}</span>
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
    </div>
  );
}
