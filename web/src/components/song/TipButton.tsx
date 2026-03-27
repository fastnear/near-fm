"use client";

import { useState, useEffect } from "react";
import type { Song } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { sendTipFromBalance, getWalletBalance } from "@/lib/api";

const TIP_AMOUNTS = [10, 50, 100, 500]; // cents: $0.10, $0.50, $1, $5

function formatCents(cents: number): string {
  const usd = cents / 100;
  return cents % 100 === 0 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;
}

/** Convert USD string to raw USDC units (6 decimals) without floating point. */
function usdToRaw(usd: string): string {
  const parts = usd.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(6, "0").slice(0, 6);
  return (BigInt(whole) * BigInt(1_000_000) + BigInt(frac)).toString();
}

export function TipButton({ song, compact, onTipSuccess }: { song: Song; compact?: boolean; onTipSuccess?: () => void }) {
  const { user, isAuthenticated, promptSignIn } = useAuth();
  const isOwnSong = user?.id === song.uploader_id;
  const { showToast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    if (showModal && isAuthenticated) {
      getWalletBalance()
        .then((b) => setBalance(b.balance_usdc_formatted))
        .catch(() => setBalance(null));
    }
  }, [showModal, isAuthenticated]);

  const handleTip = async (label: string, opts: { amount_cents?: number; amount_raw?: string }) => {
    setLoading(true);
    const toastId = showToast({ message: `Sending ${label} tip...`, type: "loading", id: "tip" });
    try {
      await sendTipFromBalance({ songUuid: song.uuid, ...opts });

      showToast({
        id: toastId,
        message: `Tip of ${label} sent!`,
        type: "success",
        duration: 5000,
      });

      setSuccess(true);
      onTipSuccess?.();
      getWalletBalance().then((b) => { setBalance(b.balance_usdc_formatted); window.dispatchEvent(new Event("nearfm_balance_updated")); }).catch(() => {});
      setTimeout(() => { setSuccess(false); setShowModal(false); }, 2000);
    } catch (e: any) {
      const msg = e?.message || "Tip failed";
      showToast({ id: toastId, message: msg, type: "error", duration: 5000 });
    }
    setLoading(false);
  };

  if (isOwnSong) {
    return (
      <div className="relative group">
        <button disabled
          className={compact
            ? "p-1.5 rounded-lg text-slate-600 cursor-not-allowed"
            : "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl font-medium bg-white/[0.02] text-slate-600 border border-white/[0.04] cursor-not-allowed"
          }
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {!compact && "Tip"}
        </button>
        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] text-slate-400 bg-slate-800 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Can&apos;t tip your own song
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!isAuthenticated) { promptSignIn(); return; }
          setShowModal(!showModal);
        }}
        className={compact
          ? "p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/15 transition-all"
          : "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/30 transition-all"
        }
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {!compact && "Tip"}
      </button>

      {showModal && (
        <div className="absolute bottom-full mb-2 left-0 rounded-2xl p-4 shadow-2xl z-50 min-w-[240px] bg-slate-900 border border-white/[0.1]">
          {success ? (
            <div className="flex items-center gap-2 text-[#00ec97] text-sm">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Tip sent!
            </div>
          ) : (
            <div className="space-y-3">
              {balance && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Balance</span>
                  <span className="text-xs font-medium text-green-400">${balance}</span>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap">
                {TIP_AMOUNTS.map((cents) => (
                  <button
                    key={cents}
                    onClick={() => handleTip(formatCents(cents), { amount_cents: cents })}
                    disabled={loading}
                    className="flex-1 min-w-[44px] px-1.5 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-50 bg-green-500/10 text-green-300 border-green-500/20 hover:bg-green-500/20"
                  >
                    {formatCents(cents)}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="$ Custom"
                  className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-green-500 focus:outline-none"
                />
                <button
                  onClick={() => {
                    const val = parseFloat(customAmount);
                    if (val >= 0.01) handleTip(`$${customAmount}`, { amount_raw: usdToRaw(customAmount) });
                  }}
                  disabled={loading || !customAmount || parseFloat(customAmount) < 0.01}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-all disabled:opacity-30"
                >
                  Tip
                </button>
              </div>
              {balance === "0.00" && (
                <a href="/balance" className="block text-center text-[10px] text-purple-400 hover:text-purple-300">
                  Top up balance →
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
