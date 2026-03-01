"use client";

import { useState, useEffect, useCallback } from "react";
import type { Category, Song } from "@/types";
import { useNearWallet } from "@/contexts/NearWalletContext";
import {
  getReports,
  reviewReport,
  getCategories,
  createCategory,
  deleteCategory,
  getSongs,
  moderateSong,
  deleteSong,
  getAdminRequests,
  moderateRequest,
  getAdminComments,
  moderateComment,
  toggleMuteUser,
  toggleBanUser,
  getAdminSongScores,
} from "@/lib/api";
import type { AdminComment, AdminSongScore } from "@/lib/api";
import { getTotalCommission, getCommissionRate } from "@/lib/near/contract";

type Tab = "reports" | "categories" | "songs" | "requests" | "comments";

interface Report {
  id: number;
  song_id: number;
  reporter_id: number;
  reason: string;
  status: string;
  created_at: string;
}

// ── Helpers ──

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Status Badge ──

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    reviewed: "bg-[#00ec97]/10 text-[#00ec97] border-[#00ec97]/20",
    dismissed: "bg-white/[0.04] text-slate-400 border-white/[0.08]",
  };
  const cls = colors[status] || "bg-white/[0.04] text-slate-400 border-white/[0.08]";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${cls}`}>
      {status}
    </span>
  );
}

// ── Reports Tab ──

function ReportsPanel() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState("");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getReports("pending");
      setReports(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleAction = async (
    reportId: number,
    action: "dismiss" | "hide"
  ) => {
    setActionLoading(reportId);
    try {
      if (action === "dismiss") {
        await reviewReport(reportId, { status: "dismissed" });
      } else {
        await reviewReport(reportId, { status: "reviewed", action: "hide" });
      }
      await fetchReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
            <div className="h-4 skeleton rounded w-1/3 mb-2" />
            <div className="h-3 skeleton rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={fetchReports}
          className="px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] rounded-xl text-sm transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-500 text-lg">No pending reports</p>
        <p className="text-slate-600 text-sm mt-1">All clear!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => (
        <div
          key={report.id}
          className="glass-card rounded-xl p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-slate-500 font-mono">
                  #{report.id}
                </span>
                <StatusBadge status={report.status} />
                <span className="text-xs text-slate-600">
                  Song ID: {report.song_id}
                </span>
              </div>
              <p className="text-sm text-slate-300 mb-1">{report.reason}</p>
              <p className="text-xs text-slate-600">
                Reported {formatDate(report.created_at)} &middot; Reporter ID:{" "}
                {report.reporter_id}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleAction(report.id, "dismiss")}
                disabled={actionLoading === report.id}
                className="px-3 py-1.5 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50 rounded-lg border border-white/[0.08] transition"
              >
                Dismiss
              </button>
              <button
                onClick={() => handleAction(report.id, "hide")}
                disabled={actionLoading === report.id}
                className="px-3 py-1.5 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 disabled:opacity-50 rounded-lg border border-rose-500/20 transition"
              >
                Hide Song
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Categories Tab ──

function CategoriesPanel() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formOrder, setFormOrder] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load categories");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleNameChange = (name: string) => {
    setFormName(name);
    setFormSlug(slugify(name));
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formSlug.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await createCategory({
        name: formName.trim(),
        slug: formSlug.trim(),
        description: formDescription.trim() || undefined,
        display_order: formOrder,
      });
      setFormName("");
      setFormSlug("");
      setFormDescription("");
      setFormOrder(0);
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create category");
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete category "${name}"? This cannot be undone.`)) {
      return;
    }
    setDeleteLoading(id);
    try {
      await deleteCategory(id);
      await fetchCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete category");
    }
    setDeleteLoading(null);
  };

  return (
    <div className="space-y-6">
      {/* Add Category Form */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
          Add Category
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Name
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Electronic"
              className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Slug
            </label>
            <input
              type="text"
              value={formSlug}
              onChange={(e) => setFormSlug(e.target.value)}
              placeholder="electronic"
              className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Category description"
              className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Display Order
            </label>
            <input
              type="number"
              value={formOrder}
              onChange={(e) => setFormOrder(Number(e.target.value))}
              className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
            />
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={submitting || !formName.trim()}
          className="mt-4 px-5 py-2 btn-primary disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition"
        >
          {submitting ? "Creating..." : "Add Category"}
        </button>
      </div>

      {/* Error */}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Categories List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="h-4 skeleton rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : categories.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500">No categories yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="glass-card rounded-xl px-4 py-3 flex items-center justify-between"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-200">
                    {cat.name}
                  </span>
                  <span className="text-xs text-slate-600 font-mono">
                    /{cat.slug}
                  </span>
                  <span className="text-xs text-slate-700">
                    order: {cat.display_order}
                  </span>
                </div>
                {cat.description && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {cat.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleDelete(cat.id, cat.name)}
                disabled={deleteLoading === cat.id}
                className="ml-4 px-3 py-1 text-xs font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 rounded-lg border border-rose-500/20 transition"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Songs Tab ──

function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(Math.abs(value) / max * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SongScoreRow({ song, maxBase }: { song: AdminSongScore; maxBase: number }) {
  const [expanded, setExpanded] = useState(false);
  const ageStr = song.age_hours < 24
    ? `${song.age_hours.toFixed(1)}h`
    : `${(song.age_hours / 24).toFixed(1)}d`;

  return (
    <div className={`glass-card rounded-xl ${song.is_hidden ? "opacity-50" : ""}`}>
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Score */}
        <div className="w-16 text-right shrink-0">
          <span className="text-sm font-bold text-purple-400">
            {song.score.toFixed(4)}
          </span>
        </div>

        {/* Title + uploader */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={`/song/${song.uuid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-slate-200 truncate hover:text-purple-400 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {song.title}
            </a>
            {song.is_hidden && (
              <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border bg-rose-500/10 text-rose-400 border-rose-500/20">
                hidden
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">
            {song.uploader_account_id} &middot; {ageStr} ago
          </p>
        </div>

        {/* Quick stats */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 shrink-0">
          <span title="Upvotes / Downvotes">{song.upvotes}/{song.downvotes}</span>
          <span title="Plays">{song.play_count} plays</span>
          <span title="Tips">{song.tips_near.toFixed(2)} N</span>
        </div>

        {/* Expand arrow */}
        <svg
          className={`w-4 h-4 text-slate-600 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Votes */}
            <div className="space-y-1.5">
              <p className="text-slate-500 font-medium uppercase tracking-wider text-[10px]">Votes (weighted)</p>
              <div className="flex justify-between text-slate-300">
                <span>Weighted upvotes</span>
                <span className="text-[#00ec97] font-mono">+{song.weighted_upvotes.toFixed(2)}</span>
              </div>
              <ScoreBar value={song.weighted_upvotes} max={maxBase} color="bg-[#00ec97]" />
              <div className="flex justify-between text-slate-300">
                <span>Weighted downvotes</span>
                <span className="text-rose-400 font-mono">-{song.weighted_downvotes.toFixed(2)}</span>
              </div>
              <ScoreBar value={song.weighted_downvotes} max={maxBase} color="bg-rose-400" />
              <div className="flex justify-between text-slate-400 pt-1 border-t border-white/[0.04]">
                <span>Net votes</span>
                <span className="font-mono">{(song.weighted_upvotes - song.weighted_downvotes).toFixed(2)}</span>
              </div>
            </div>

            {/* Signals */}
            <div className="space-y-1.5">
              <p className="text-slate-500 font-medium uppercase tracking-wider text-[10px]">Signals</p>
              <div className="flex justify-between text-slate-300">
                <span>Plays ({song.play_count})</span>
                <span className="text-cyan-400 font-mono">+{song.play_score.toFixed(2)}</span>
              </div>
              <ScoreBar value={song.play_score} max={maxBase} color="bg-cyan-400" />
              <div className="flex justify-between text-slate-300">
                <span>Tips ({song.tips_near.toFixed(2)} NEAR)</span>
                <span className="text-amber-400 font-mono">+{song.tips_score.toFixed(2)}</span>
              </div>
              <ScoreBar value={song.tips_score} max={maxBase} color="bg-amber-400" />
            </div>

            {/* Formula breakdown */}
            <div className="sm:col-span-2 glass rounded-lg p-3 space-y-1 font-mono text-[11px]">
              <div className="flex justify-between text-slate-400">
                <span>base = votes + plays + tips</span>
                <span>{song.base_score.toFixed(4)}</span>
              </div>
              {song.newbie_multiplier < 1 && (
                <div className="flex justify-between text-amber-400">
                  <span>newbie penalty</span>
                  <span>&times; {song.newbie_multiplier}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-400">
                <span>age divisor = max({song.age_hours.toFixed(1)}h - 24, 0) + 2) ^ 1.8</span>
                <span>&divide; {song.age_divisor.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-purple-400 font-bold border-t border-white/[0.06] pt-1">
                <span>final score</span>
                <span>{song.score.toFixed(6)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SongsPanel() {
  const [mode, setMode] = useState<"scores" | "search">("scores");
  const [scores, setScores] = useState<AdminSongScore[]>([]);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Load scores
  useEffect(() => {
    if (mode !== "scores") return;
    setScoresLoading(true);
    getAdminSongScores()
      .then(setScores)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load scores"))
      .finally(() => setScoresLoading(false));
  }, [mode]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const searchSongs = useCallback(async () => {
    if (!debouncedQuery.trim()) {
      setSongs([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await getSongs({ q: debouncedQuery, limit: 20 });
      setSongs(data.songs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    }
    setLoading(false);
  }, [debouncedQuery]);

  useEffect(() => {
    if (mode === "search") searchSongs();
  }, [searchSongs, mode]);

  const handleToggleHide = async (song: Song) => {
    setActionLoading(song.uuid);
    try {
      await moderateSong(song.uuid, { is_hidden: !song.is_hidden });
      await searchSongs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
    setActionLoading(null);
  };

  const handleDelete = async (song: Song) => {
    if (!window.confirm(`Permanently delete "${song.title}"? This cannot be undone.`)) return;
    setActionLoading(song.uuid);
    try {
      await deleteSong(song.uuid);
      await searchSongs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
    setActionLoading(null);
  };

  const maxBase = scores.length > 0 ? Math.max(...scores.map((s) => Math.abs(s.base_score)), 1) : 1;

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("scores")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
            mode === "scores"
              ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
              : "bg-white/[0.04] text-slate-500 border-white/[0.08] hover:text-slate-300"
          }`}
        >
          All Songs (by score)
        </button>
        <button
          onClick={() => setMode("search")}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
            mode === "search"
              ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
              : "bg-white/[0.04] text-slate-500 border-white/[0.08] hover:text-slate-300"
          }`}
        >
          Search & Moderate
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {mode === "scores" ? (
        <>
          {scoresLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
                  <div className="h-4 skeleton rounded w-1/3 mb-2" />
                  <div className="h-3 skeleton rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : scores.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">No songs found</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {scores.map((song, i) => (
                  <div key={song.uuid} className="flex items-start gap-2">
                    <span className="text-xs text-slate-600 font-mono w-6 text-right pt-3.5 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <SongScoreRow song={song} maxBase={maxBase} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Formula explanation */}
              <div className="glass-card rounded-xl p-5 mt-6">
                <h3 className="text-sm font-semibold text-slate-300 mb-3">How the trending score is calculated</h3>
                <div className="font-mono text-xs text-slate-400 space-y-1.5">
                  <p><span className="text-slate-300">base</span> = weighted_upvotes - weighted_downvotes + log10(plays) &times; 2 + log10(tips_NEAR + 1) &times; 9</p>
                  <p><span className="text-amber-400">if</span> uploader has &lt; 3 uploads AND reputation &lt; 1.5: <span className="text-amber-400">base &times;= 0.5</span> (newbie penalty)</p>
                  <p><span className="text-cyan-400">effective_age</span> = max(age_hours - 24, 0) &mdash; no decay in first 24 hours</p>
                  <p><span className="text-purple-400">score</span> = base / (effective_age + 2) ^ 1.8</p>
                </div>
                <div className="mt-3 text-xs text-slate-500 space-y-1">
                  <p>Vote weight = voter&apos;s reputation &times; anti-spam (voters with reputation &le; 1.0 get &times;0.5)</p>
                  <p>Scores are recalculated every 5 minutes by the server</p>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        /* Search mode - same as before */
        <>
          <div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search songs by title..."
              className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
            />
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
                  <div className="h-4 skeleton rounded w-1/3 mb-2" />
                  <div className="h-3 skeleton rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : !debouncedQuery.trim() ? (
            <div className="text-center py-16">
              <p className="text-slate-500">Enter a search term to find songs</p>
            </div>
          ) : songs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">No songs found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {songs.map((song) => (
                <div
                  key={song.uuid}
                  className="glass-card rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {song.title}
                      </span>
                      {song.is_hidden && (
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded border bg-rose-500/10 text-rose-400 border-rose-500/20">
                          hidden
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      Uploaded by{" "}
                      <span className="text-slate-400">
                        {song.uploader_display_name || song.uploader_account_id}
                      </span>
                      {" "}&middot;{" "}
                      {formatDate(song.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/song/${song.uuid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-500 hover:text-white hover:bg-white/[0.06] rounded-lg border border-white/[0.08] transition"
                      title="Open song"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                    <button
                      onClick={() => handleToggleHide(song)}
                      disabled={actionLoading === song.uuid}
                      className="px-3 py-1.5 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50 rounded-lg border border-white/[0.08] transition"
                    >
                      {song.is_hidden ? "Unhide" : "Hide"}
                    </button>
                    <button
                      onClick={() => handleDelete(song)}
                      disabled={actionLoading === song.uuid}
                      className="px-3 py-1.5 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 disabled:opacity-50 rounded-lg border border-rose-500/20 transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Requests Tab ──

function RequestsPanel() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const searchRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let all = await getAdminRequests();
      if (debouncedQuery.trim()) {
        const q = debouncedQuery.toLowerCase();
        all = all.filter(
          (r: any) =>
            r.title.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            (r.requester_account_id && r.requester_account_id.toLowerCase().includes(q))
        );
      }
      setRequests(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load requests");
    }
    setLoading(false);
  }, [debouncedQuery]);

  useEffect(() => {
    searchRequests();
  }, [searchRequests]);

  const handleToggleHide = async (req: any) => {
    setActionLoading(req.uuid);
    try {
      await moderateRequest(req.uuid, { is_hidden: !req.is_hidden });
      await searchRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
    setActionLoading(null);
  };

  const handleStartEdit = (req: any) => {
    setEditingUuid(req.uuid);
    setEditTitle(req.title);
    setEditDescription(req.description);
  };

  const handleSaveEdit = async () => {
    if (!editingUuid) return;
    setActionLoading(editingUuid);
    try {
      await moderateRequest(editingUuid, {
        title: editTitle,
        description: editDescription,
      });
      setEditingUuid(null);
      await searchRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
    setActionLoading(null);
  };

  const handleCancelEdit = () => {
    setEditingUuid(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search requests by title, description, or account..."
          className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="h-4 skeleton rounded w-1/3 mb-2" />
              <div className="h-3 skeleton rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500">No requests found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((req: any) => (
            <div
              key={req.uuid}
              className="glass-card rounded-xl px-4 py-3"
            >
              {editingUuid === req.uuid ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full border border-white/[0.08] bg-white/[0.04] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={3}
                      className="w-full border border-white/[0.08] bg-white/[0.04] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition resize-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={actionLoading === req.uuid}
                      className="px-4 py-1.5 text-xs font-medium btn-primary disabled:opacity-50 rounded-lg transition"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-4 py-1.5 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] rounded-lg border border-white/[0.08] transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {req.title}
                      </span>
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${
                        req.status === "open"
                          ? "bg-[#00ec97]/10 text-[#00ec97] border-[#00ec97]/20"
                          : "bg-white/[0.04] text-slate-400 border-white/[0.08]"
                      }`}>
                        {req.status}
                      </span>
                      {req.is_hidden && (
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded border bg-rose-500/10 text-rose-400 border-rose-500/20">
                          hidden
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-1">
                      {req.description}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      by {req.requester_account_id} &middot; {formatDate(req.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`/requests/${req.uuid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-500 hover:text-white hover:bg-white/[0.06] rounded-lg border border-white/[0.08] transition"
                      title="Open request"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                    <button
                      onClick={() => handleStartEdit(req)}
                      className="px-3 py-1.5 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] rounded-lg border border-white/[0.08] transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleHide(req)}
                      disabled={actionLoading === req.uuid}
                      className="px-3 py-1.5 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 disabled:opacity-50 rounded-lg border border-rose-500/20 transition"
                    >
                      {req.is_hidden ? "Unhide" : "Hide"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Comments Tab ──

function CommentsPanel() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [muteLoading, setMuteLoading] = useState<string | null>(null);
  const [banLoading, setBanLoading] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getAdminComments(debouncedQuery.trim() || undefined);
      setComments(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comments");
    }
    setLoading(false);
  }, [debouncedQuery]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleToggleHide = async (comment: AdminComment) => {
    setActionLoading(comment.id);
    try {
      await moderateComment(comment.id, !comment.is_hidden);
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id ? { ...c, is_hidden: !c.is_hidden } : c
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
    setActionLoading(null);
  };

  const handleToggleMute = async (accountId: string, mute: boolean) => {
    if (!window.confirm(`${mute ? "Mute" : "Unmute"} user "${accountId}"?`)) return;
    setMuteLoading(accountId);
    try {
      await toggleMuteUser(accountId, mute);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mute failed");
    }
    setMuteLoading(null);
  };

  const handleToggleBan = async (accountId: string, ban: boolean) => {
    const msg = ban
      ? `Ban user "${accountId}"? This will hide all their songs, comments, and delete their votes.`
      : `Unban user "${accountId}"? Their songs and comments will be restored.`;
    if (!window.confirm(msg)) return;
    setBanLoading(accountId);
    try {
      await toggleBanUser(accountId, ban);
      await fetchComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ban failed");
    }
    setBanLoading(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search comments by text or account..."
          className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="h-4 skeleton rounded w-1/3 mb-2" />
              <div className="h-3 skeleton rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500">No comments found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={`glass-card rounded-xl px-4 py-3 ${comment.is_hidden ? "opacity-60" : ""}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-medium text-slate-300">
                      {comment.author_display_name || comment.author_account_id}
                    </span>
                    {comment.is_hidden && (
                      <span className="inline-block px-2 py-0.5 text-xs font-medium rounded border bg-rose-500/10 text-rose-400 border-rose-500/20">
                        hidden
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 mb-1.5 whitespace-pre-wrap">{comment.body}</p>
                  <p className="text-xs text-slate-600">
                    on{" "}
                    <a
                      href={`/song/${comment.song_uuid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 hover:text-purple-400 transition-colors"
                    >
                      {comment.song_title}
                    </a>
                    {" "}&middot;{" "}
                    {formatDate(comment.created_at)}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleHide(comment)}
                    disabled={actionLoading === comment.id}
                    className="px-3 py-1.5 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50 rounded-lg border border-white/[0.08] transition"
                  >
                    {comment.is_hidden ? "Show" : "Hide"}
                  </button>
                  <button
                    onClick={() => handleToggleMute(comment.author_account_id, true)}
                    disabled={muteLoading === comment.author_account_id}
                    className="px-3 py-1.5 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 disabled:opacity-50 rounded-lg border border-rose-500/20 transition"
                  >
                    Mute User
                  </button>
                  <button
                    onClick={() => handleToggleBan(comment.author_account_id, true)}
                    disabled={banLoading === comment.author_account_id}
                    className="px-3 py-1.5 text-xs font-medium bg-red-600/10 hover:bg-red-600/20 text-red-400 disabled:opacity-50 rounded-lg border border-red-600/20 transition"
                  >
                    Ban
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Admin Page ──

function yoctoToNear(yocto: string): string {
  const near = Number(yocto) / 1e24;
  return near < 0.01 ? near.toFixed(6) : near.toFixed(2);
}

export default function AdminPage() {
  const { accountId, signIn, loading } = useNearWallet();
  const [activeTab, setActiveTab] = useState<Tab>("reports");
  const [commission, setCommission] = useState<string | null>(null);
  const [commissionRate, setCommissionRate] = useState<number | null>(null);

  useEffect(() => {
    getTotalCommission().then(setCommission).catch(() => {});
    getCommissionRate().then(setCommissionRate).catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!accountId) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="glass-card rounded-3xl p-12 text-center">
          <h1 className="text-2xl font-bold mb-2">Admin Panel</h1>
          <p className="text-slate-400 mb-6">
            Connect your NEAR wallet to access the admin panel
          </p>
          <button
            onClick={signIn}
            className="px-6 py-3 btn-primary rounded-lg font-medium transition"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "reports", label: "Reports" },
    { key: "songs", label: "Songs" },
    { key: "requests", label: "Requests" },
    { key: "comments", label: "Comments" },
    { key: "categories", label: "Categories" },
  ];

  return (
    <div>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
            <p className="text-sm text-slate-500 mt-1">
              Signed in as{" "}
              <span className="text-slate-400 font-mono">{accountId}</span>
            </p>
          </div>
          {commission !== null && (
            <div className="glass-card rounded-xl px-4 py-3 text-right">
              <p className="text-lg font-bold text-[#00ec97]">{yoctoToNear(commission)} NEAR</p>
              <p className="text-xs text-slate-500">
                Platform commission{commissionRate !== null ? ` (${commissionRate / 100}%)` : ""}
              </p>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-white/[0.06] pb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition ${
                activeTab === tab.key
                  ? "bg-white/[0.06] text-purple-400 border-b-2 border-purple-500"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "reports" && <ReportsPanel />}
        {activeTab === "songs" && <SongsPanel />}
        {activeTab === "requests" && <RequestsPanel />}
        {activeTab === "comments" && <CommentsPanel />}
        {activeTab === "categories" && <CategoriesPanel />}
      </div>
    </div>
  );
}
