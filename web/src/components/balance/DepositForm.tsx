"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useSolanaWallet } from "@/contexts/SolanaWalletContext";
import { getWalletBalance, backupWallet, restoreWallet } from "@/lib/api";
import {
  ensureRegistered,
  getAddress,
  createDepositIntent,
  getDepositStatus,
  type DepositIntent,
} from "@/lib/outlayer";

const USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DECIMALS = 6;

const BRIDGE_CHAINS = [
  { id: "solana", name: "Solana", estSecs: 20 },
  { id: "ethereum", name: "Ethereum", estSecs: 45 },
  { id: "base", name: "Base", estSecs: 35 },
  { id: "arbitrum", name: "Arbitrum", estSecs: 25 },
  { id: "polygon", name: "Polygon", estSecs: 35 },
  { id: "optimism", name: "Optimism", estSecs: 35 },
  { id: "avalanche", name: "Avalanche", estSecs: 35 },
] as const;

// Map EVM chain_id to bridge chain id (for deposit pre-selection)
const CHAIN_ID_TO_BRIDGE: Record<number, string> = {
  1: "ethereum", 8453: "base", 42161: "arbitrum",
  10: "optimism", 137: "polygon", 43114: "avalanche",
  56: "ethereum", // BSC deposit not available yet
};

function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac)).toString();
}

type DepositStep = "idle" | "creating_intent" | "waiting_send" | "bridging" | "done" | "error";

export function DepositForm({ onDeposited }: { onDeposited?: () => void }) {
  const { user, isAuthenticated, refreshUser } = useAuth();
  const { accountId, callFunction, viewMethod } = useNearWallet();
  const { solanaAddress } = useSolanaWallet();

  const [amountUsd, setAmountUsd] = useState("");
  const [step, setStep] = useState<DepositStep>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [bridgeIntent, setBridgeIntent] = useState<DepositIntent | null>(null);
  const [bridgeChain, setBridgeChain] = useState<string>("solana");
  const [copied, setCopied] = useState(false);
  const [nearUsdcBalance, setNearUsdcBalance] = useState<string | null>(null);

  const hasSolana = !!solanaAddress || !!user?.solana_address;
  const hasNear = !!accountId;
  const hasEth = !!user?.eth_address;

  // Set default bridge chain based on connected wallet/chain
  useEffect(() => {
    if (hasEth && user?.eth_chain_id) {
      setBridgeChain(CHAIN_ID_TO_BRIDGE[user.eth_chain_id] || "ethereum");
    } else if (hasSolana) {
      setBridgeChain("solana");
    } else {
      setBridgeChain("ethereum");
    }
  }, [hasSolana, hasEth, user?.eth_chain_id]);

  // Fetch NEAR USDC balance
  useEffect(() => {
    if (!accountId || !viewMethod) return;
    viewMethod({
      contractId: USDC_CONTRACT,
      method: "ft_balance_of",
      args: { account_id: accountId },
    }).then((raw) => {
      const val = BigInt(String(raw ?? "0"));
      const whole = val / BigInt(10 ** DECIMALS);
      const frac = val % BigInt(10 ** DECIMALS);
      setNearUsdcBalance(`${whole}.${frac.toString().padStart(DECIMALS, "0").replace(/0+$/, "") || "0"}`);
    }).catch(() => {});
  }, [accountId, viewMethod]);

  const ensureWallet = useCallback(async (): Promise<string> => {
    try {
      const restored = await restoreWallet();
      if (restored.api_key) {
        const localKey = localStorage.getItem("nearfm_outlayer_api_key");
        if (localKey && localKey !== restored.api_key) {
          localStorage.setItem(`nearfm_outlayer_api_key_backup_${Date.now()}`, localKey);
        }
        localStorage.setItem("nearfm_outlayer_api_key", restored.api_key);
        return restored.api_key;
      }
    } catch {}

    const localKey = localStorage.getItem("nearfm_outlayer_api_key");
    if (localKey) {
      getAddress(localKey).then(({ address }) => backupWallet(localKey, address)).catch(() => {});
      return localKey;
    }

    const apiKey = await ensureRegistered();
    try {
      const { address } = await getAddress(apiKey);
      await backupWallet(apiKey, address);
    } catch {}
    return apiKey;
  }, []);

  async function handleNearDeposit() {
    if (!user || !accountId || !callFunction) return;
    const usd = parseFloat(amountUsd);
    if (isNaN(usd) || usd < 0.01) { setError("Minimum $0.01"); setStep("error"); return; }
    setError(""); setResult(null);
    try {
      setStep("creating_intent");
      const apiKey = await ensureWallet();
      const { address: agentHex } = await getAddress(apiKey);
      const rawAmount = toMinimalUnits(amountUsd, DECIMALS);
      setStep("waiting_send");
      await callFunction({
        contractId: USDC_CONTRACT,
        method: "ft_transfer_call",
        args: { receiver_id: "intents.near", amount: rawAmount, msg: agentHex },
        gas: "100000000000000",
        deposit: "1",
      });
      setResult(`+$${usd.toFixed(2)} deposited`);
      setStep("done");
      onDeposited?.();
      await refreshUser();
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("User rejected") || msg.includes("cancelled")) { setStep("idle"); return; }
      setError(msg); setStep("error");
    }
  }

  async function handleBridgeDeposit() {
    if (!user) return;
    const usd = parseFloat(amountUsd);
    if (isNaN(usd) || usd < 0.13) { setError("Minimum $0.13 (bridge fee)"); setStep("error"); return; }
    setError(""); setResult(null);
    try {
      setStep("creating_intent");
      const apiKey = await ensureWallet();
      const rawAmount = toMinimalUnits(amountUsd, DECIMALS);
      const intent = await createDepositIntent(apiKey, bridgeChain, rawAmount, "USDC");
      setBridgeIntent(intent);
      setStep("waiting_send");
    } catch (e: any) {
      setError(e?.message || "Failed"); setStep("error");
    }
  }

  async function handleBridgeConfirmSent() {
    if (!bridgeIntent) return;
    try {
      setStep("bridging");
      const apiKey = await ensureWallet();
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await getDepositStatus(apiKey, bridgeIntent.intent_id);
        if (status.status === "success") {
          setResult(`+$${(parseInt(bridgeIntent.amount_out) / 1e6).toFixed(2)} deposited`);
          setStep("done"); setBridgeIntent(null); onDeposited?.(); return;
        }
        if (status.status === "failed" || status.status === "expired") throw new Error(`Bridge ${status.status}`);
      }
      throw new Error("Bridge timeout");
    } catch (e: any) {
      setError(e?.message || "Bridge failed"); setStep("error"); setBridgeIntent(null);
    }
  }

  const chainInfo = BRIDGE_CHAINS.find((c) => c.id === bridgeChain) || BRIDGE_CHAINS[0];

  if (!isAuthenticated) return null;

  return (
    <div className="space-y-3">
      {/* NEAR direct deposit toggle */}
      {hasNear && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <span>NEAR wallet USDC:</span>
          <span className={`font-medium ${amountUsd && parseFloat(nearUsdcBalance || "0") < parseFloat(amountUsd) ? "text-red-400" : "text-slate-400"}`}>
            {nearUsdcBalance ?? "..."}
          </span>
        </div>
      )}

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
        <input
          type="number" min="0.01" step="0.01" placeholder="1.00"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          disabled={step !== "idle" && step !== "error" && step !== "done"}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2.5 pl-7 pr-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-white/[0.2] transition-colors"
        />
      </div>

      <div className="flex gap-2">
        {["1", "5", "10", "25"].map((v) => (
          <button key={v} onClick={() => setAmountUsd(v)}
            className="flex-1 py-1.5 rounded-lg text-xs bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08] transition-all"
          >${v}</button>
        ))}
      </div>

      {/* Bridge chain selector */}
      {step !== "waiting_send" && step !== "bridging" && (
        <div>
          <div className="text-xs text-slate-500 mb-1.5">Deposit from:</div>
          <div className="flex gap-1.5 flex-wrap">
            {hasNear && (
              <button onClick={() => setBridgeChain("near")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  bridgeChain === "near"
                    ? "bg-white/[0.1] text-slate-200 border-white/[0.15]"
                    : "bg-white/[0.04] text-slate-500 border-white/[0.06] hover:bg-white/[0.08]"
                }`}
              >NEAR</button>
            )}
            {BRIDGE_CHAINS.map((c) => (
              <button key={c.id} onClick={() => setBridgeChain(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  bridgeChain === c.id
                    ? "bg-white/[0.1] text-slate-200 border-white/[0.15]"
                    : "bg-white/[0.04] text-slate-500 border-white/[0.06] hover:bg-white/[0.08]"
                }`}
              >{c.name}</button>
            ))}
          </div>
        </div>
      )}

      {/* Bridge quote */}
      {step === "waiting_send" && bridgeIntent && (
        <div className="bg-purple-500/[0.08] border border-purple-500/20 rounded-xl p-4 space-y-3">
          <div className="text-sm font-medium text-purple-300">Send USDC from {chainInfo.name} wallet</div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">You send:</span>
            <span className="text-white font-medium">{amountUsd} USDC</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">You receive:</span>
            <span className="text-green-400 font-medium">{(parseInt(bridgeIntent.amount_out) / 1e6).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} USDC</span>
          </div>
          <div className="border-t border-white/[0.06] pt-3">
            <div className="text-xs text-slate-400 mb-1.5">Send to this {chainInfo.name} address:</div>
            <div className="flex items-start gap-2">
              <div className="flex-1 bg-black/30 rounded-lg px-3 py-2 font-mono text-xs text-slate-200 break-all cursor-pointer hover:bg-black/40 transition"
                onClick={() => { navigator.clipboard.writeText(bridgeIntent.deposit_address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              >{bridgeIntent.deposit_address}</div>
              <button onClick={() => { navigator.clipboard.writeText(bridgeIntent.deposit_address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="shrink-0 px-3 py-2 text-xs font-medium text-slate-300 bg-white/[0.06] border border-white/[0.1] rounded-lg hover:bg-white/[0.1] transition-all">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="text-xs text-amber-400/80 mt-2">Important: send exactly {amountUsd} USDC on {chainInfo.name}. A different amount may result in lost funds.</div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleBridgeConfirmSent} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 transition-all">
              I&apos;ve sent it
            </button>
            <button onClick={() => { setStep("idle"); setBridgeIntent(null); }} className="px-4 py-2.5 rounded-xl text-sm text-slate-400 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "bridging" && (
        <div className="bg-cyan-500/[0.08] border border-cyan-500/20 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 animate-spin text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <div>
            <div className="text-sm text-cyan-300">Bridging from {chainInfo.name}...</div>
            <div className="text-[11px] text-slate-500">Usually takes ~{chainInfo.estSecs} seconds</div>
          </div>
        </div>
      )}

      {step !== "waiting_send" && step !== "bridging" && (
        <button
          onClick={bridgeChain === "near" ? handleNearDeposit : handleBridgeDeposit}
          disabled={step === "creating_intent" || !amountUsd || parseFloat(amountUsd) < 0.01 || (bridgeChain === "near" && nearUsdcBalance !== null && parseFloat(nearUsdcBalance) < parseFloat(amountUsd))}
          className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {step === "creating_intent" ? "Preparing..." : `Deposit via ${bridgeChain === "near" ? "NEAR" : chainInfo.name}`}
        </button>
      )}

      {error && <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">{error}</div>}
      {result && step === "done" && <div className="text-green-400 text-xs bg-green-400/[0.08] rounded-lg p-3">{result}</div>}
    </div>
  );
}
