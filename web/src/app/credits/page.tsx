"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getWalletBalance } from "@/lib/api";
import { useEffect } from "react";

const CREDIT_PRICE_CENTS = 1; // 1 credit = $0.01
const SONG_COST = 12; // credits per song

const QUICK_AMOUNTS = [
  { credits: 100, label: "$1", cents: 100 },
  { credits: 500, label: "$5", cents: 500 },
  { credits: 1000, label: "$10", cents: 1000 },
  { credits: 2500, label: "$25", cents: 2500 },
];

export default function CreditsPage() {
  const { user, isAuthenticated, loading: authLoading, promptSignIn, refreshUser } = useAuth();
  const [balance, setBalance] = useState<string>("0.00");
  const [customAmount, setCustomAmount] = useState("");
  const [buying, setBuying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      getWalletBalance().then((b) => setBalance(b.balance_usdc_formatted)).catch(() => {});
    }
  }, [isAuthenticated]);

  const handleBuy = async (credits: number) => {
    if (!user) return;
    const cents = credits * CREDIT_PRICE_CENTS;

    setBuying(true);
    setError("");
    setResult(null);

    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/credits/buy-from-balance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents: cents }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Error ${resp.status}`);
      }

      const data = await resp.json();
      setResult(`+${data.credits_added} credits added!`);
      await refreshUser();
      getWalletBalance().then((b) => setBalance(b.balance_usdc_formatted)).catch(() => {});
    } catch (e: any) {
      setError(e?.message || "Purchase failed");
    }
    setBuying(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full skeleton" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gradient inline-block">AI Credits</h1>
          <p className="text-slate-400">
            Credits for AI song generation. 1 song = {SONG_COST} credits.
          </p>
        </div>

        {/* Current credits */}
        {isAuthenticated && user && (
          <div className="glass-card rounded-2xl p-6 text-center">
            <div className="text-sm text-slate-400 mb-1">Your credits</div>
            <div className="text-4xl font-bold text-white">
              {user.credit_balance?.toLocaleString() ?? 0}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              ≈ {Math.floor((user.credit_balance || 0) / SONG_COST)} songs
            </div>
            {user.daily_credits_remaining > 0 && (
              <div className="text-xs text-cyan-400 mt-1">
                + {user.daily_credits_remaining} free daily credits (premium)
              </div>
            )}
          </div>
        )}

        {/* Buy credits */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="text-sm font-medium text-slate-300">Buy Credits</div>

          {!isAuthenticated ? (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">Sign in to buy credits</p>
              <button onClick={promptSignIn} className="btn-primary px-6 py-2 rounded-xl text-sm">
                Sign In
              </button>
            </div>
          ) : (
            <>
              {/* Balance info */}
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-slate-500">Wallet balance:</span>
                <span className="text-green-400 font-medium">${balance}</span>
              </div>

              {/* Quick buy buttons */}
              <div className="grid grid-cols-2 gap-2">
                {QUICK_AMOUNTS.map(({ credits, label, cents }) => (
                  <button
                    key={cents}
                    onClick={() => handleBuy(credits)}
                    disabled={buying}
                    className="py-3 rounded-xl text-sm font-medium bg-white/[0.04] text-slate-300 border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] transition-all disabled:opacity-30"
                  >
                    <span className="text-white font-bold">{credits}</span> credits
                    <span className="block text-xs text-slate-500 mt-0.5">{label} · {Math.floor(credits / SONG_COST)} songs</span>
                  </button>
                ))}
              </div>

              {/* Custom amount */}
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  placeholder="Custom credits"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  disabled={buying}
                  className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-white/[0.2]"
                />
                <button
                  onClick={() => {
                    const n = parseInt(customAmount);
                    if (n >= 1) handleBuy(n);
                  }}
                  disabled={buying || !customAmount || parseInt(customAmount) < 1}
                  className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white rounded-lg hover:opacity-90 disabled:opacity-30 transition-all"
                >
                  Buy
                </button>
              </div>

              {/* Top up balance link */}
              {balance === "0.00" && (
                <Link href="/balance" className="block text-center text-xs text-purple-400 hover:text-purple-300">
                  Top up wallet balance first →
                </Link>
              )}

              {/* Status */}
              {error && (
                <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">
                  {error}
                  {error.includes("balance") && (
                    <Link href="/balance" className="block mt-1 text-purple-400 hover:text-purple-300 underline">
                      Top up balance →
                    </Link>
                  )}
                </div>
              )}
              {result && (
                <div className="text-green-400 text-xs bg-green-400/[0.08] rounded-lg p-3">{result}</div>
              )}
            </>
          )}
        </div>

        {/* Info */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="text-sm font-medium text-slate-300">About Credits</div>
          <div className="text-xs text-slate-400 space-y-2">
            <p>Credits are used exclusively for AI song generation. 1 credit = $0.01.</p>
            <p>Credits cannot be withdrawn or converted back to cash.</p>
            <p className="text-slate-500">Premium users get 40 free credits daily.</p>
          </div>
        </div>

        <div className="text-center">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
