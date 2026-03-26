"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { getWalletBalance } from "@/lib/api";

const SONG_COST = 12;
const LYRICS_COST = 1;

const QUICK_AMOUNTS = [
  { credits: 100, cents: 100 },
  { credits: 500, cents: 500 },
  { credits: 1000, cents: 1000 },
  { credits: 2500, cents: 2500 },
];

export default function CreditsPage() {
  const { user, isAuthenticated, isPremium, loading: authLoading, promptSignIn, refreshUser } = useAuth();
  const [balanceCents, setBalanceCents] = useState(0);
  const [balanceFormatted, setBalanceFormatted] = useState("0.00");
  const [customAmount, setCustomAmount] = useState("");
  const [buying, setBuying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      getWalletBalance().then((b) => {
        setBalanceFormatted(b.balance_usdc_formatted);
        setBalanceCents(Math.floor(parseInt(b.balance_usdc || "0") / 10000));
      }).catch(() => {});
    }
  }, [isAuthenticated]);

  const handleBuy = async (credits: number) => {
    if (!user) return;
    setBuying(true);
    setError("");
    setResult(null);
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/credits/buy-from-balance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents: credits }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Error ${resp.status}`);
      }
      const data = await resp.json();
      setResult(`+${data.credits_added} credits added!`);
      await refreshUser();
      getWalletBalance().then((b) => {
        setBalanceFormatted(b.balance_usdc_formatted);
        setBalanceCents(Math.floor(parseInt(b.balance_usdc || "0") / 10000));
      }).catch(() => {});
    } catch (e: any) {
      setError(e?.message || "Purchase failed");
    }
    setBuying(false);
  };

  const maxCredits = balanceCents; // 1 credit = 1 cent
  const affordableAmounts = QUICK_AMOUNTS.filter(a => a.cents <= balanceCents);

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
            Credits are required for AI song and lyrics generation.
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
                <div className="flex items-center gap-2">
                  <span className="text-green-400 font-medium">${balanceFormatted}</span>
                  <Link href="/balance" className="text-purple-400 hover:text-purple-300">Top up</Link>
                </div>
              </div>

              {/* Quick buy buttons — only show affordable options */}
              {affordableAmounts.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {affordableAmounts.map(({ credits, cents }) => (
                    <button
                      key={cents}
                      onClick={() => handleBuy(credits)}
                      disabled={buying}
                      className="py-3 rounded-xl text-sm font-medium bg-white/[0.04] text-slate-300 border border-white/[0.06] hover:bg-white/[0.08] hover:border-white/[0.12] transition-all disabled:opacity-30"
                    >
                      <span className="text-white font-bold">{credits}</span> credits
                      <span className="block text-xs text-slate-500 mt-0.5">${(cents / 100).toFixed(0)} · {Math.floor(credits / SONG_COST)} songs</span>
                    </button>
                  ))}
                </div>
              ) : balanceCents > 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">Use custom amount below (max {maxCredits} credits)</p>
              ) : (
                <div className="text-center py-3">
                  <p className="text-xs text-slate-500 mb-2">No wallet balance. Top up to buy credits.</p>
                  <Link href="/balance" className="text-xs text-purple-400 hover:text-purple-300">
                    Top up wallet balance →
                  </Link>
                </div>
              )}

              {/* Custom amount + Max */}
              {balanceCents > 0 && (
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max={maxCredits}
                    placeholder="Custom credits"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    disabled={buying}
                    className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-white/[0.2]"
                  />
                  <button
                    onClick={() => setCustomAmount(String(maxCredits))}
                    className="px-2 py-2 text-xs text-purple-400 bg-purple-500/10 rounded-lg hover:bg-purple-500/15 transition"
                  >
                    Max
                  </button>
                  <button
                    onClick={() => {
                      const n = parseInt(customAmount);
                      if (n >= 1 && n <= maxCredits) handleBuy(n);
                    }}
                    disabled={buying || !customAmount || parseInt(customAmount) < 1 || parseInt(customAmount) > maxCredits}
                    className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white rounded-lg hover:opacity-90 disabled:opacity-30 transition-all"
                  >
                    Buy
                  </button>
                </div>
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

        {/* Pricing table */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="text-sm font-medium text-slate-300">Pricing</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-slate-400">Song generation</div>
            <div className="text-slate-300">{SONG_COST} credits ($0.{SONG_COST.toString().padStart(2, "0")})</div>
            <div className="text-slate-400">Lyrics generation</div>
            <div className="text-slate-300">{LYRICS_COST} credit ($0.0{LYRICS_COST})</div>
            <div className="text-slate-400">1 credit</div>
            <div className="text-slate-300">$0.01</div>
          </div>
        </div>

        {/* Info */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="text-xs text-slate-400 space-y-2">
            <p>Credits are used for AI song and lyrics generation. They cannot be withdrawn or converted back to cash.</p>
            <p className="text-slate-500">Premium users get 40 free credits daily — enough for 3 songs + 4 lyrics per day.</p>
          </div>
          {!isPremium && isAuthenticated && (
            <Link
              href="/premium"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/15 transition diamond-shimmer"
            >
              ✦ Get Premium — 40 free credits daily
            </Link>
          )}
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
