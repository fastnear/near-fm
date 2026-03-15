"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useToast } from "@/components/ui/Toast";
import { premiumSubscribe } from "@/lib/api";
import { ensureRegistered, getAddress, createCheck } from "@/lib/outlayer";

const USDC_CONTRACT =
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT_CONTRACT = "usdt.tether-token.near";
const DECIMALS = 6;

const TOKENS: Record<string, { contract: string }> = {
  USDC: { contract: USDC_CONTRACT },
  USDT: { contract: USDT_CONTRACT },
};

const PLANS = [
  { label: "1 month",  usd: 10,  days: 30 },
  { label: "2 months", usd: 20,  days: 60 },
  { label: "3 months", usd: 30,  days: 90 },
  { label: "1 year",   usd: 120, days: 365 },
];

function toMinimalUnits(usd: number): string {
  return (usd * 10 ** DECIMALS).toString();
}

interface Props {
  /** Profile slug of the recipient */
  accountId: string;
  displayName: string | null;
  recipientHasPremium: boolean;
}

export function GiftPremiumButton({ accountId, displayName, recipientHasPremium }: Props) {
  const { isAuthenticated } = useAuth();
  const { accountId: walletId, wallet, callFunction, connectWallet, viewMethod } = useNearWallet();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<"USDC" | "USDT">("USDC");
  const [selectedPlan, setSelectedPlan] = useState(0);
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Fetch stablecoin balance when modal opens
  useEffect(() => {
    if (!walletId || !open) return;
    viewMethod({
      contractId: TOKENS[selectedToken].contract,
      method: "ft_balance_of",
      args: { account_id: walletId },
    })
      .then((raw) => {
        const val = BigInt(String(raw ?? "0"));
        const whole = val / BigInt(10 ** DECIMALS);
        const frac = val % BigInt(10 ** DECIMALS);
        setBalance(`${whole}.${frac.toString().padStart(DECIMALS, "0").replace(/0+$/, "") || "0"}`);
      })
      .catch(() => setBalance(null));
  }, [walletId, open, selectedToken, viewMethod]);

  const handleGift = async () => {
    if (!wallet || !walletId) { connectWallet(); return; }

    const plan = PLANS[selectedPlan];
    setLoading(true);
    const toastId = showToast({ message: "Waiting for wallet...", type: "loading", id: "gift-prem" });

    try {
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

      showToast({ id: toastId, message: "Creating payment check...", type: "loading" });

      const check = await createCheck(apiKey, tokenContract, rawAmount);
      const res = await premiumSubscribe(check.check_key, accountId);

      showToast({
        id: toastId,
        message: `✦ Gifted ${res.days_added} days of Premium to ${displayName || accountId}!`,
        type: "success",
        duration: 6000,
      });

      setDone(true);
      setOpen(false);
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      if (msg.includes("User rejected") || msg.includes("User cancelled")) {
        showToast({ id: toastId, message: "Cancelled", type: "error", duration: 2000 });
      } else {
        showToast({ id: toastId, message: `Gift failed: ${msg}`, type: "error", duration: 5000 });
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) return null;

  const plan = PLANS[selectedPlan];
  const insufficient = balance !== null && parseFloat(balance) < plan.usd;

  return (
    <div className="relative">
      <button
        onClick={() => { if (!wallet) { connectWallet(); return; } setOpen(!open); }}
        className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-medium border transition-all ${
          done
            ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
            : "bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/20 hover:border-purple-500/30"
        }`}
      >
        <span className="text-xs">✦</span>
        {done ? "Premium gifted!" : "Gift Premium"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 right-0 rounded-2xl p-4 shadow-2xl z-50 w-72 bg-slate-900 border border-white/[0.1]">
            <p className="text-xs font-medium text-slate-300 mb-1">
              Gift Premium to <span className="text-white">{displayName || accountId}</span>
            </p>
            <p className="text-[11px] text-slate-500 mb-3">
              {recipientHasPremium ? "They already have Premium — this will extend it" : "Pay with USDC or USDT"}
            </p>

            {/* Plan selector */}
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {PLANS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedPlan(i)}
                  className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                    selectedPlan === i
                      ? "bg-purple-500/15 border-purple-500/40 text-white"
                      : "bg-white/[0.04] border-white/[0.08] text-slate-400 hover:bg-white/[0.08]"
                  }`}
                >
                  <span className="font-bold">${p.usd}</span>
                  <span className="text-slate-500 ml-1">{p.label}</span>
                </button>
              ))}
            </div>

            {/* Token selector */}
            <div className="flex gap-1.5 mb-3">
              {(["USDC", "USDT"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedToken(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedToken === t
                      ? "bg-white/[0.12] text-slate-100 border border-white/[0.15]"
                      : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Balance */}
            {balance !== null && (
              <div className="flex items-center justify-between text-[11px] mb-3 px-0.5">
                <span className="text-slate-500">Your balance:</span>
                <span className={insufficient ? "text-red-400 font-medium" : "text-slate-300"}>
                  {balance} {selectedToken}
                </span>
              </div>
            )}

            <button
              onClick={handleGift}
              disabled={loading || insufficient}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading ? "Processing..." : insufficient ? `Need $${plan.usd} ${selectedToken}` : `Gift ${plan.days} days — $${plan.usd}`}
            </button>

            {insufficient && (
              <p className="text-[10px] text-slate-600 text-center mt-2">
                Not enough {selectedToken} in your wallet
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
