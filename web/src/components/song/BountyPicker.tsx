"use client";

import { useState, useEffect } from "react";
import type { SongRequest } from "@/types";
import { getRequests } from "@/lib/api";

function formatBounty(req: SongRequest): string {
  if (req.bounty_usd_cents) return `$${(req.bounty_usd_cents / 100).toFixed(2)}`;
  const near = Number(req.bounty_amount_yocto) / 1e24;
  return `${near % 1 === 0 ? near.toFixed(0) : near.toFixed(2)} NEAR`;
}

export function BountyPicker({ value, onChange }: {
  value: SongRequest | null;
  onChange: (req: SongRequest | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!open || fetched) return;
    setLoading(true);
    getRequests({ status: "open", sort: "newest", limit: 50 })
      .then((data) => { setRequests(data.requests); setFetched(true); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, fetched]);

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-500 hover:text-slate-300 transition-colors">
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {value
            ? <span className="text-purple-400">Fulfilling: {value.title} ({formatBounty(value)})</span>
            : "Submit for a bounty request"}
        </span>
        <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-white/[0.06]">
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
              <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
              Loading open requests...
            </div>
          ) : requests.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No open bounty requests at the moment.</p>
          ) : (
            <div className="space-y-2 pt-3 max-h-64 overflow-y-auto">
              {value && (
                <button type="button" onClick={() => onChange(null)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-500 hover:bg-white/[0.04] transition-colors">
                  Clear selection
                </button>
              )}
              {requests.map((req) => (
                <button key={req.id} type="button"
                  onClick={() => onChange(value?.id === req.id ? null : req)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                    value?.id === req.id
                      ? "bg-purple-500/10 border border-purple-500/30"
                      : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
                  }`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-300 truncate">{req.title}</span>
                    <span className="text-xs text-purple-400 font-medium shrink-0">{formatBounty(req)}</span>
                  </div>
                  {req.description && <p className="text-xs text-slate-500 mt-1 line-clamp-1">{req.description}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
