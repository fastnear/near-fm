"use client";

import { useEffect, useState } from "react";
import type { Genre, Category, Language } from "@/types";
import { getGenres, getCategories, getLanguages, getFeedPreferences, updateFeedPreferences } from "@/lib/api";
import { useNearWallet } from "@/contexts/NearWalletContext";

export function FeedPreferences() {
  const { accountId } = useNearWallet();
  const [genres, setGenres] = useState<Genre[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [excludedGenres, setExcludedGenres] = useState<Set<number>>(new Set());
  const [excludedLanguages, setExcludedLanguages] = useState<Set<number>>(new Set());
  const [excludedCategories, setExcludedCategories] = useState<Set<number>>(new Set());
  const [hideNoCover, setHideNoCover] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getGenres(), getCategories(), getLanguages()]).then(
      ([g, c, l]) => {
        setGenres(g);
        setCategories(c);
        setLanguages(l);
      }
    );
  }, []);

  useEffect(() => {
    if (!accountId) return;
    getFeedPreferences(accountId)
      .then((prefs) => {
        setExcludedGenres(new Set(prefs.excluded_genres));
        setExcludedLanguages(new Set(prefs.excluded_languages));
        setExcludedCategories(new Set(prefs.excluded_categories));
        setHideNoCover(prefs.hide_no_cover);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accountId]);

  const save = async (
    eg: Set<number>,
    el: Set<number>,
    ec: Set<number>,
    noCover: boolean
  ) => {
    if (!accountId) return;
    setSaving(true);
    try {
      await updateFeedPreferences(accountId, {
        excluded_genres: [...eg],
        excluded_languages: [...el],
        excluded_categories: [...ec],
        hide_no_cover: noCover,
      });
    } catch (e) {
      console.error("Failed to save preferences:", e);
    }
    setSaving(false);
  };

  const toggleGenre = (id: number) => {
    const next = new Set(excludedGenres);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcludedGenres(next);
    save(next, excludedLanguages, excludedCategories, hideNoCover);
  };

  const toggleLanguage = (id: number) => {
    const next = new Set(excludedLanguages);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcludedLanguages(next);
    save(excludedGenres, next, excludedCategories, hideNoCover);
  };

  const toggleCategory = (id: number) => {
    const next = new Set(excludedCategories);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcludedCategories(next);
    save(excludedGenres, excludedLanguages, next, hideNoCover);
  };

  const toggleNoCover = () => {
    const next = !hideNoCover;
    setHideNoCover(next);
    save(excludedGenres, excludedLanguages, excludedCategories, next);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl skeleton" />
        ))}
      </div>
    );
  }

  const chipClass = (excluded: boolean) =>
    `inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer transition-all border ${
      excluded
        ? "bg-white/[0.02] text-slate-600 border-white/[0.04] hover:border-white/[0.08]"
        : "bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/15"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-400 mb-4">
          Customize your feed by excluding content you don&apos;t want to see. Click chips to toggle. {saving && <span className="text-purple-400">Saving...</span>}
        </p>
      </div>

      {/* Settings */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Settings
        </h3>
        <button
          onClick={toggleNoCover}
          className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
        >
          <div className={`w-10 h-6 rounded-full transition-colors relative ${hideNoCover ? "bg-purple-500" : "bg-white/[0.08]"}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${hideNoCover ? "left-5" : "left-1"}`} />
          </div>
          <div>
            <span className="text-sm text-slate-200">Hide songs without cover image</span>
            <p className="text-xs text-slate-500">Only show songs that have a cover artwork</p>
          </div>
        </button>
      </div>

      {/* Genres */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Genres
        </h3>
        <div className="flex flex-wrap gap-2">
          {genres.map((g) => (
            <button
              key={g.id}
              onClick={() => toggleGenre(g.id)}
              className={chipClass(excludedGenres.has(g.id))}
            >
              {excludedGenres.has(g.id) && (
                <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {/* Languages */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Languages
        </h3>
        <div className="flex flex-wrap gap-2">
          {languages.map((l) => (
            <button
              key={l.id}
              onClick={() => toggleLanguage(l.id)}
              className={chipClass(excludedLanguages.has(l.id))}
            >
              {excludedLanguages.has(l.id) && (
                <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {l.name}
            </button>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Categories
        </h3>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => toggleCategory(c.id)}
              className={chipClass(excludedCategories.has(c.id))}
            >
              {excludedCategories.has(c.id) && (
                <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
