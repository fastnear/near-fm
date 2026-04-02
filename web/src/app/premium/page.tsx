"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

const FEATURES = [
  {
    title: "40 free daily AI credits",
    desc: "Generate up to 3 songs per day for free — resets every midnight UTC. Uses any Suno model including the latest V5.5.",
  },
  {
    title: "Diamond Likes",
    desc: "Highlight the best tracks with Diamond Likes — they carry more weight and boost songs to the top.",
  },
  {
    title: "Playlists",
    desc: "Create and manage playlists, export them to your phone.",
  },
  {
    title: "Premium badge",
    desc: "Stand out with a premium badge on your profile and comments.",
  },
  {
    title: "Video generation",
    desc: "Generate promo videos for any song with visualizer and cover art — download and share on social media.",
  },
  {
    title: "Early access",
    desc: "Be the first to try new platform features.",
  },
];

export default function PremiumPage() {
  const { user, isAuthenticated, loading: authLoading, promptSignIn } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full skeleton" />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold diamond-shimmer inline-block">
            NEAR FM Premium
          </h1>
          <p className="text-slate-400 text-lg">
            Unlock AI music generation and exclusive features
          </p>
          {user?.is_premium && (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-medium">
              <span>✦</span>
              Active until {new Date(user.premium_until!).toLocaleDateString()}
            </div>
          )}
        </div>

        {/* Feature list */}
        <div className="glass-card rounded-2xl p-6 space-y-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <span className="text-cyan-400 text-xl mt-0.5 shrink-0">✦</span>
              <div>
                <div className="font-medium text-slate-200">{f.title}</div>
                <div className="text-sm text-slate-400">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Pricing + buy */}
        <div className="glass-card rounded-2xl p-6 space-y-5">
          <div className="text-sm font-medium text-slate-300">Subscribe</div>
          <p className="text-xs text-slate-500">$10/month · paid from wallet balance (USDC)</p>

          {!isAuthenticated ? (
            <div className="text-center py-2 space-y-3">
              <p className="text-slate-400 text-sm">Sign in to subscribe</p>
              <button onClick={promptSignIn} className="btn-primary px-6 py-2 rounded-xl text-sm">
                Sign In
              </button>
            </div>
          ) : (
            <PremiumFromBalance />
          )}

        </div>

        {/* Daily credits explainer */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="text-sm font-medium text-slate-300">How daily credits work</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="text-slate-400">Daily free credits</div>
            <div className="text-slate-300 font-medium">40 / day</div>
            <div className="text-slate-400">1 song generation</div>
            <div className="text-slate-300">12 credits</div>
            <div className="text-slate-400">Songs per day</div>
            <div className="text-slate-300">up to 3 (+ 4 lyrics)</div>
            <div className="text-slate-400">Resets</div>
            <div className="text-slate-300">midnight UTC</div>
            <div className="text-slate-400">Suno models</div>
            <div className="text-slate-300">all incl. V5</div>
          </div>
          <p className="text-xs text-slate-500">
            Daily credits are spent before purchased credits — no credits lost if you have both.
            If daily credits run out mid-session, purchased credits cover the difference automatically.
          </p>
          {isAuthenticated && user && (
            <Link href="/credits" className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
              Buy additional credits →
            </Link>
          )}
        </div>

        <div className="text-center">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

function PremiumFromBalance() {
  const [months, setMonths] = useState(1);
  const [buying, setBuying] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    import("@/lib/api").then(({ getWalletBalance }) =>
      getWalletBalance().then((b) => setBalance(b.balance_usdc_formatted)).catch(() => {})
    );
  }, []);

  const price = months * 10;
  const balanceNum = parseFloat(balance || "0");
  const canAfford = balanceNum >= price;

  const handleBuy = async () => {
    setBuying(true);
    setError("");
    try {
      const { buyPremiumFromBalance } = await import("@/lib/api");
      const res = await buyPremiumFromBalance(months);
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || "Purchase failed");
    }
    setBuying(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-slate-500">Wallet balance:</span>
        <span className={`font-medium ${canAfford ? "text-green-400" : "text-red-400"}`}>${balance || "..."}</span>
      </div>

      <div className="flex gap-2">
        {[1, 3, 12].map((m) => (
          <button
            key={m}
            onClick={() => setMonths(m)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
              months === m
                ? "bg-purple-500/15 text-purple-300 border-purple-500/25"
                : "bg-white/[0.04] text-slate-400 border-white/[0.06] hover:bg-white/[0.08]"
            }`}
          >
            {m} mo
            <span className="block text-xs text-slate-500">${m * 10}</span>
          </button>
        ))}
      </div>

      <button
        onClick={handleBuy}
        disabled={buying || !canAfford}
        className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {buying ? "Processing..." : `Subscribe — $${price}`}
      </button>

      {!canAfford && balance !== null && (
        <a href={`/balance?amount=${price}`} className="block text-center text-xs text-purple-400 hover:text-purple-300">
          Top up balance (need ${price}) →
        </a>
      )}

      {error && <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">{error}</div>}

      <p className="text-[11px] text-slate-600 text-center">
        Gift premium to someone? Visit their profile and click &quot;Gift Premium&quot;.
      </p>
    </div>
  );
}
