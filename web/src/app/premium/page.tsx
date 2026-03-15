"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { premiumSubscribe } from "@/lib/api";
import { ensureRegistered, getAddress, createCheck } from "@/lib/outlayer";

const USDC_CONTRACT =
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT_CONTRACT = "usdt.tether-token.near";
const DECIMALS = 6;

const TOKENS: Record<string, { contract: string; label: string }> = {
  USDC: { contract: USDC_CONTRACT, label: "USDC" },
  USDT: { contract: USDT_CONTRACT, label: "USDT" },
};

const PLANS = [
  { months: 1, usd: 10, days: 30 },
  { months: 2, usd: 20, days: 60 },
  { months: 3, usd: 30, days: 90 },
  { months: 12, usd: 120, days: 365 },
];

const PENDING_KEY = "nearfm_premium_pending";

interface PendingState {
  token: string;
  amount: string;
  step: "deposited" | "check_created";
  checkKey?: string;
  accountId: string;
}

function toMinimalUnits(usd: number): string {
  // 6 decimals: $10 = 10_000_000
  return (usd * 10 ** DECIMALS).toString();
}

const FEATURES = [
  {
    title: "40 free daily AI credits",
    desc: "Generate up to 3 songs per day for free — resets every midnight UTC. Uses any Suno model including the latest V5.",
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
    title: "Early access",
    desc: "Be the first to try new platform features.",
  },
];

export default function PremiumPage() {
  const { user, isAuthenticated, loading: authLoading, refreshUser, promptSignIn } = useAuth();
  const { accountId: walletId, wallet, callFunction, connectWallet, viewMethod } = useNearWallet();

  const [selectedToken, setSelectedToken] = useState<"USDC" | "USDT">("USDC");
  const [selectedPlan, setSelectedPlan] = useState(0); // index into PLANS
  const [step, setStep] = useState<"idle" | "depositing" | "creating_check" | "claiming" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ premium_until: string; days_added: number } | null>(null);
  const [tokenBalances, setTokenBalances] = useState<{ USDC: string | null; USDT: string | null }>({ USDC: null, USDT: null });

  // Fetch stablecoin balances
  useEffect(() => {
    if (!walletId) return;
    const fetchBalance = async (token: "USDC" | "USDT") => {
      try {
        const raw = await viewMethod({
          contractId: TOKENS[token].contract,
          method: "ft_balance_of",
          args: { account_id: walletId },
        });
        const val = BigInt(String(raw ?? "0"));
        const whole = val / BigInt(10 ** DECIMALS);
        const frac = val % BigInt(10 ** DECIMALS);
        return `${whole}.${frac.toString().padStart(DECIMALS, "0").replace(/0+$/, "") || "0"}`;
      } catch {
        return null;
      }
    };
    Promise.all([fetchBalance("USDC"), fetchBalance("USDT")]).then(([usdc, usdt]) => {
      setTokenBalances({ USDC: usdc, USDT: usdt });
    });
  }, [walletId, viewMethod, result]);

  const runSubscribe = useCallback(async (pending: PendingState) => {
    try {
      if (pending.step === "deposited") {
        setStep("creating_check");
        const apiKey = await ensureRegistered();
        const check = await createCheck(apiKey, pending.token, pending.amount);
        pending.step = "check_created";
        pending.checkKey = check.check_key;
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      }

      if (pending.step === "check_created" && pending.checkKey) {
        setStep("claiming");
        const res = await premiumSubscribe(pending.checkKey, pending.accountId);
        setResult({ premium_until: res.premium_until, days_added: res.days_added });
        setStep("done");
        localStorage.removeItem(PENDING_KEY);
        await refreshUser();
      }
    } catch (e: any) {
      setError(e.message || "Subscription failed");
      setStep("error");
      localStorage.removeItem(PENDING_KEY);
    }
  }, [refreshUser]);

  // Resume pending on mount
  useEffect(() => {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw || !user) return;
    try {
      const pending: PendingState = JSON.parse(raw);
      runSubscribe(pending);
    } catch {
      localStorage.removeItem(PENDING_KEY);
    }
  }, [user, runSubscribe]);

  async function handleSubscribe() {
    if (!user || !wallet || !walletId) return;

    const plan = PLANS[selectedPlan];
    setError("");
    setResult(null);

    try {
      setStep("depositing");
      const apiKey = await ensureRegistered();
      const { address: agentHex } = await getAddress(apiKey);

      const tokenContract = TOKENS[selectedToken].contract;
      const rawAmount = toMinimalUnits(plan.usd);

      await callFunction({
        contractId: tokenContract,
        method: "ft_transfer_call",
        args: { receiver_id: "intents.near", amount: rawAmount, msg: agentHex },
        gas: "100000000000000",
        deposit: "1",
      });

      const accountIdToCredit = user.near_account_id || user.slug;
      const pending: PendingState = {
        token: tokenContract,
        amount: rawAmount,
        step: "deposited",
        accountId: accountIdToCredit,
      };
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

      await runSubscribe(pending);
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      if (msg.includes("User rejected") || msg.includes("User cancelled")) {
        setStep("idle");
        return;
      }
      setError(msg);
      setStep("error");
    }
  }

  const plan = PLANS[selectedPlan];
  const busy = step === "depositing" || step === "creating_check" || step === "claiming";
  const balance = tokenBalances[selectedToken];
  const insufficient = balance !== null && parseFloat(balance) < plan.usd;

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
          <div className="text-sm font-medium text-slate-300">Choose a plan</div>

          {/* Plan selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PLANS.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPlan(i)}
                className={`flex flex-col items-center py-3 px-2 rounded-xl border text-sm transition-all ${
                  selectedPlan === i
                    ? "bg-purple-500/15 border-purple-500/40 text-white"
                    : "bg-white/[0.04] border-white/[0.08] text-slate-400 hover:bg-white/[0.08]"
                }`}
              >
                <span className="font-bold text-base">${p.usd}</span>
                <span className="text-xs mt-0.5 text-slate-500">
                  {p.months === 12 ? "12 months" : `${p.months} month${p.months > 1 ? "s" : ""}`}
                </span>
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-500 text-center">
            ${plan.usd} = {plan.days} days · $10/month · paid in USDC or USDT
          </div>

          {/* Auth / wallet gates */}
          {!isAuthenticated ? (
            <div className="text-center py-2 space-y-3">
              <p className="text-slate-400 text-sm">Sign in to subscribe</p>
              <button onClick={promptSignIn} className="btn-primary px-6 py-2 rounded-xl text-sm">
                Sign In
              </button>
            </div>
          ) : !wallet ? (
            <div className="text-center py-2 space-y-3">
              <p className="text-slate-400 text-sm">Connect your NEAR wallet to pay with USDC/USDT</p>
              <button onClick={connectWallet} className="btn-primary px-6 py-2 rounded-xl text-sm">
                Connect Wallet
              </button>
            </div>
          ) : (
            <>
              {/* Token selector */}
              <div className="flex gap-2">
                {(["USDC", "USDT"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedToken(t)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedToken === t
                        ? "bg-white/[0.12] text-slate-100 border border-white/[0.15]"
                        : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Wallet balance */}
              {balance !== null && (
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-slate-500">Wallet balance:</span>
                  <span className={`font-medium ${insufficient ? "text-red-400" : "text-slate-300"}`}>
                    {balance} {selectedToken}
                  </span>
                </div>
              )}

              <button
                onClick={handleSubscribe}
                disabled={busy || insufficient}
                className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {step === "depositing" && "Waiting for wallet..."}
                {step === "creating_check" && "Creating payment check..."}
                {step === "claiming" && "Activating premium..."}
                {!busy && insufficient && `Insufficient ${selectedToken}`}
                {!busy && !insufficient && (user?.is_premium ? `Extend by ${plan.days} days — $${plan.usd}` : `Subscribe — $${plan.usd}`)}
              </button>

              {insufficient && (
                <p className="text-xs text-slate-500 text-center">
                  You need ${plan.usd} {selectedToken} in your wallet. Get USDC on{" "}
                  <a href="https://www.near.com" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                    near.com
                  </a>{" "}or{" "}
                  <a href="https://rhea.finance/" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                    Rhea Finance
                  </a>.
                </p>
              )}

              {error && (
                <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">{error}</div>
              )}

              {result && step === "done" && (
                <div className="text-green-400 text-xs bg-green-400/[0.08] rounded-lg p-3">
                  ✓ Premium activated! +{result.days_added} days, active until{" "}
                  {new Date(result.premium_until).toLocaleDateString()}.
                </div>
              )}
            </>
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
