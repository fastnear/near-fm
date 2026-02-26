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
} from "@/lib/api";

type Tab = "reports" | "categories" | "songs";

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
    reviewed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
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

function SongsPanel() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
    searchSongs();
  }, [searchSongs]);

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
    if (
      !window.confirm(
        `Permanently delete "${song.title}"? This cannot be undone.`
      )
    ) {
      return;
    }
    setActionLoading(song.uuid);
    try {
      await deleteSong(song.uuid);
      await searchSongs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
    setActionLoading(null);
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs by title..."
          className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
        />
      </div>

      {/* Error */}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Results */}
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
          <p className="text-slate-500">
            Enter a search term to find songs
          </p>
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
    </div>
  );
}

// ── Main Admin Page ──

export default function AdminPage() {
  const { accountId, signIn, loading } = useNearWallet();
  const [activeTab, setActiveTab] = useState<Tab>("reports");

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
    { key: "categories", label: "Categories" },
    { key: "songs", label: "Songs" },
  ];

  return (
    <div>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-sm text-slate-500 mt-1">
            Signed in as{" "}
            <span className="text-slate-400 font-mono">{accountId}</span>
          </p>
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
        {activeTab === "categories" && <CategoriesPanel />}
        {activeTab === "songs" && <SongsPanel />}
      </div>
    </div>
  );
}
