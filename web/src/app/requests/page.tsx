"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { SongRequest } from "@/types";
import { getRequests } from "@/lib/api";
import { useNearWallet } from "@/contexts/NearWalletContext";

type Tab = "open" | "awarded" | "all";
type SortOption = "newest" | "highest_bounty";

function formatNear(yocto: string): string {
  const near = Number(yocto) / 1e24;
  return near % 1 === 0 ? near.toFixed(0) : near.toFixed(2);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const isOpen = status === "open";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
        isOpen
          ? "bg-[#00ec97]/10 text-[#00ec97] border border-[#00ec97]/20"
          : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
      }`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function RequestsPage() {
  const { accountId } = useNearWallet();
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("open");
  const [sort, setSort] = useState<SortOption>("newest");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const LIMIT = 12;

  const fetchData = useCallback(async (pageNum: number, append: boolean) => {
    setLoading(true);
    try {
      const status = tab === "all" ? undefined : tab;
      const sortParam = sort === "highest_bounty" ? "bounty" : "newest";
      const data = await getRequests({
        status,
        sort: sortParam,
        page: pageNum,
        limit: LIMIT,
      });
      if (append) {
        setRequests((prev) => [...prev, ...data.requests]);
      } else {
        setRequests(data.requests);
      }
      setHasMore(data.requests.length >= LIMIT);
    } catch (e) {
      console.error("Failed to load requests:", e);
    }
    setLoading(false);
  }, [tab, sort]);

  useEffect(() => {
    setPage(1);
    fetchData(1, false);
  }, [fetchData]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchData(nextPage, true);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "open", label: "Open" },
    { key: "awarded", label: "Awarded" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <h1 className="text-2xl font-bold">Song Requests</h1>
        {accountId && (
          <Link
            href="/requests/new"
            className="inline-flex items-center justify-center px-5 py-2.5 btn-primary rounded-xl font-medium transition text-sm"
          >
            + Create Request
          </Link>
        )}
      </div>

      {/* Tabs and Sort */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        {/* Tabs */}
        <div className="flex gap-1 glass rounded-2xl p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                tab === t.key
                  ? "bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-white border border-purple-500/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="border border-white/[0.08] bg-white/[0.04] text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 transition"
        >
          <option value="newest">Newest</option>
          <option value="highest_bounty">Highest Bounty</option>
        </select>
      </div>

      {/* Request Cards */}
      {loading && requests.length === 0 ? (
        <div className="grid gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="glass-card rounded-2xl p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <div className="h-5 skeleton rounded w-1/3" />
                  <div className="h-4 skeleton rounded w-2/3" />
                </div>
                <div className="h-6 w-20 skeleton rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-slate-500 text-lg">No requests found</p>
          <p className="text-slate-600 text-sm mt-2">
            {tab === "open"
              ? "Be the first to create a song request with a bounty!"
              : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((req) => (
            <Link
              key={req.uuid}
              href={`/requests/${req.uuid}`}
              className="block glass-card card-shine rounded-2xl p-6 hover:border-purple-500/20 transition group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-lg font-semibold group-hover:text-purple-400 transition truncate">
                      {req.title}
                    </h2>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className="text-slate-400 text-sm line-clamp-2 mb-3">
                    {req.description}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    {(req as any).requester_account_id && (
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className="inline"
                      >
                        by{" "}
                        <Link
                          href={`/profile/${(req as any).requester_account_id}`}
                          className="text-purple-400 hover:text-purple-300 transition"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(req as any).requester_account_id}
                        </Link>
                      </span>
                    )}
                    <span>{formatDate(req.created_at)}</span>
                    {req.expires_at && (
                      <span>Expires {formatDate(req.expires_at)}</span>
                    )}
                  </div>
                </div>

                {/* Bounty amount */}
                <div className="flex-shrink-0 text-right">
                  <div className="text-lg font-bold text-purple-400">
                    {formatNear(req.bounty_amount_yocto)} NEAR
                  </div>
                  <div className="text-xs text-slate-500">bounty</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && !loading && (
        <div className="flex justify-center mt-8">
          <button
            onClick={handleLoadMore}
            className="px-6 py-2.5 btn-ghost rounded-lg text-sm font-medium transition"
          >
            Load More
          </button>
        </div>
      )}

      {loading && requests.length > 0 && (
        <div className="flex justify-center mt-8">
          <div className="text-slate-500 text-sm">Loading...</div>
        </div>
      )}
    </div>
  );
}
