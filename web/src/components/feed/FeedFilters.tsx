"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    getCategories().then(setCategories).catch(console.error);
    getGenres().then(setGenres).catch(console.error);
    getLanguages().then(setLanguages).catch(console.error);
  }, []);

  const selectClass =
    "rounded-xl px-3 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 focus:outline-none transition-all appearance-none cursor-pointer hover:border-white/[0.15]";

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

      {/* Language */}
      <select
        value={languageId ?? ""}
        onChange={(e) =>
          onLanguageChange(e.target.value ? Number(e.target.value) : undefined)
        }
        className={selectClass}
      >
        <option value="">All languages</option>
        {languages.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      {/* Category */}
      <select
        value={categoryId ?? ""}
        onChange={(e) =>
          onCategoryChange(e.target.value ? Number(e.target.value) : undefined)
        }
        className={selectClass}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {/* Genre */}
      <select
        value={genreSlug ?? ""}
        onChange={(e) =>
          onGenreChange(e.target.value || undefined)
        }
        className={selectClass}
      >
        <option value="">All genres</option>
        {genres.map((g) => (
          <option key={g.id} value={g.slug}>
            {g.name}
          </option>
        ))}
      </select>

      {/* Period (only for Top) */}
      {showPeriod && (
        <select
          value={period ?? "all"}
          onChange={(e) => onPeriodChange(e.target.value as TimePeriod)}
          className={selectClass}
        >
          <option value="day">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
      )}
    </div>
  );
}
