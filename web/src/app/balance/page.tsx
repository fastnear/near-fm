"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useSolanaWallet } from "@/contexts/SolanaWalletContext";
import { getWalletBalance, backupWallet, restoreWallet, withdrawFromBalance } from "@/lib/api";
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

const WITHDRAW_CHAINS = [
  { id: "near", name: "NEAR", placeholder: "account.near" },
  { id: "solana", name: "Solana", placeholder: "So1ana..." },
  { id: "ethereum", name: "Ethereum", placeholder: "0x..." },
  { id: "base", name: "Base", placeholder: "0x..." },
  { id: "arbitrum", name: "Arbitrum", placeholder: "0x..." },
  { id: "bsc", name: "BSC", placeholder: "0x..." },
  { id: "polygon", name: "Polygon", placeholder: "0x..." },
  { id: "optimism", name: "Optimism", placeholder: "0x..." },
  { id: "avalanche", name: "Avalanche", placeholder: "0x..." },
] as const;

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

export default function BalancePageWrapper() {
  return <Suspense><BalancePage /></Suspense>;
}

function BalancePage() {
  const { user, isAuthenticated, loading: authLoading, refreshUser, promptSignIn } = useAuth();
  const { accountId, callFunction } = useNearWallet();
  const { solanaAddress } = useSolanaWallet();

  const searchParams = useSearchParams();
  const [balanceFormatted, setBalanceFormatted] = useState("0.00");
  const [balanceRaw, setBalanceRaw] = useState("0");
  const [amountUsd, setAmountUsd] = useState(searchParams.get("amount") || "");
  const [step, setStep] = useState<DepositStep>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [bridgeIntent, setBridgeIntent] = useState<DepositIntent | null>(null);
  const [bridgeChain, setBridgeChain] = useState<string>("solana");
  const [copied, setCopied] = useState(false);

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

  const fetchBalance = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const b = await getWalletBalance();
      setBalanceFormatted(b.balance_usdc_formatted);
      setBalanceRaw(b.balance_usdc || "0");
      window.dispatchEvent(new Event("nearfm_balance_updated"));
    } catch {
      setBalanceFormatted("0.00");
    }
  }, [isAuthenticated]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  // ── NEAR direct deposit ──
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
      await fetchBalance();
      await refreshUser();
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("User rejected") || msg.includes("cancelled")) { setStep("idle"); return; }
      setError(msg); setStep("error");
    }
  }

  // ── Cross-chain bridge deposit ──
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
      setError(e?.message || "Failed to create deposit"); setStep("error");
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
          setStep("done"); setBridgeIntent(null); await fetchBalance(); return;
        }
        if (status.status === "failed" || status.status === "expired") throw new Error(`Bridge ${status.status}`);
      }
      throw new Error("Bridge timeout");
    } catch (e: any) {
      setError(e?.message || "Bridge failed"); setStep("error"); setBridgeIntent(null);
    }
  }

  const chainInfo = BRIDGE_CHAINS.find((c) => c.id === bridgeChain) || BRIDGE_CHAINS[0];

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
          <h1 className="text-3xl font-bold text-gradient inline-block">Balance</h1>
          <p className="text-slate-400">
            Your USDC balance for tips, credits, and bounties.
          </p>
        </div>

        {/* Balance display */}
        {isAuthenticated && user && (
          <div className="glass-card rounded-2xl p-6 text-center">
            <div className="text-sm text-slate-400 mb-1">Your balance</div>
            <div className="text-4xl font-bold text-white">${balanceFormatted}</div>
            <div className="text-xs text-slate-500 mt-2">USDC on Intents (on-chain)</div>
            {user.credit_balance > 0 && (
              <div className="text-xs text-cyan-400 mt-1">+ {user.credit_balance} legacy credits</div>
            )}
          </div>
        )}

        {/* Deposit form */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="text-sm font-medium text-slate-300">Add Funds</div>

          {!isAuthenticated ? (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">Sign in to manage your balance</p>
              <button onClick={promptSignIn} className="btn-primary px-6 py-2 rounded-xl text-sm">Sign In</button>
            </div>
          ) : (
            <>
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

              {/* Chain selector */}
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
                    <button onClick={handleBridgeConfirmSent}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 transition-all">
                      I&apos;ve sent it
                    </button>
                    <button onClick={() => { setStep("idle"); setBridgeIntent(null); }}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-400 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all">
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
                  disabled={step === "creating_intent" || !amountUsd || parseFloat(amountUsd) < 0.01}
                  className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {step === "creating_intent" ? "Preparing..." : `Deposit via ${bridgeChain === "near" ? "NEAR" : chainInfo.name}`}
                </button>
              )}

              {error && <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">{error}</div>}
              {result && step === "done" && <div className="text-green-400 text-xs bg-green-400/[0.08] rounded-lg p-3">{result}</div>}
            </>
          )}
        </div>

        {/* Legacy NEAR virtual balance */}
        {isAuthenticated && hasNear && accountId && (
          <LegacyNearBalance accountId={accountId} />
        )}

        {/* Withdraw */}
        {isAuthenticated && parseFloat(balanceFormatted) > 0 && (
          <WithdrawSection
            hasNear={hasNear}
            hasSolana={hasSolana}
            nearAccountId={accountId || user?.near_account_id || ""}
            solanaAddress={solanaAddress || user?.solana_address || ""}
            balanceRaw={balanceRaw}
            onSuccess={fetchBalance}
          />
        )}

        {/* What you can do with balance */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="text-sm font-medium text-slate-300">What you can spend on</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="text-slate-400">AI song generation</div>
            <div className="text-slate-300">$0.12 / song</div>
            <div className="text-slate-400">Tips to artists</div>
            <div className="text-slate-300">any amount</div>
            <div className="text-slate-400">Song request bounties</div>
            <div className="text-slate-300">$1+ bounty</div>
            <div className="text-slate-400">Premium subscription</div>
            <div className="text-slate-300">$10 / month</div>
          </div>
        </div>

        <div className="text-center">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">Back to home</Link>
        </div>
      </div>
    </div>
  );
}

/** Withdraw USDC to wallet on any chain */
function WithdrawSection({ hasNear, hasSolana, nearAccountId, solanaAddress, balanceRaw, onSuccess }: {
  hasNear: boolean; hasSolana: boolean; nearAccountId: string; solanaAddress: string; balanceRaw: string; onSuccess: () => void;
}) {
  const defaultChain = hasNear ? "near" : hasSolana ? "solana" : "ethereum";
  const defaultAddr = hasNear ? nearAccountId : hasSolana ? solanaAddress : "";
  const [chain, setChain] = useState(defaultChain);
  const [receiver, setReceiver] = useState(defaultAddr);
  const [amount, setAmount] = useState("");
  const [isMax, setIsMax] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const chainMeta = WITHDRAW_CHAINS.find((c) => c.id === chain) || WITHDRAW_CHAINS[0];

  const handleMax = () => {
    const raw = parseInt(balanceRaw || "0");
    const whole = Math.floor(raw / 1_000_000);
    const frac = raw % 1_000_000;
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
    setAmount(fracStr ? `${whole}.${fracStr}` : `${whole}`);
    setIsMax(true);
  };

  const handleChainChange = (newChain: string) => {
    setChain(newChain);
    if (newChain === "near") setReceiver(nearAccountId);
    else if (newChain === "solana") setReceiver(solanaAddress);
    else setReceiver("");
  };

  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="text-sm font-medium text-slate-300">Withdraw</div>

      {/* Chain selector */}
      <div>
        <label className="text-xs text-slate-500 mb-1 block">Chain</label>
        <select
          value={chain}
          onChange={(e) => handleChainChange(e.target.value)}
          disabled={loading}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-white/[0.2] appearance-none cursor-pointer"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundRepeat: "no-repeat", backgroundSize: "1.5em 1.5em", paddingRight: "2.5rem" }}
        >
          {WITHDRAW_CHAINS.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Receiver address */}
      <div>
        <label className="text-xs text-slate-500 mb-1 block">{chainMeta.name} address</label>
        <input type="text" value={receiver} onChange={(e) => setReceiver(e.target.value)}
          placeholder={chainMeta.placeholder} disabled={loading}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-white/[0.2]" />
      </div>

      {/* Amount + Max + Withdraw */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
          <input type="number" min="0.01" step="0.01" placeholder="1.00" value={amount}
            onChange={(e) => { setAmount(e.target.value); setIsMax(false); }} disabled={loading}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 pl-7 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-white/[0.2]" />
        </div>
        <button onClick={handleMax} disabled={loading}
          className="px-3 py-2 text-xs font-medium text-slate-400 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] transition-all">
          Max
        </button>
        <button onClick={async () => {
          const usd = parseFloat(amount);
          if (isNaN(usd) || usd < 0.01) { setError("Min $0.01"); return; }
          if (!receiver.trim()) { setError("Enter address"); return; }
          setLoading(true); setError(""); setSuccess("");
          try {
            const opts = isMax ? { amount_raw: balanceRaw } : { amount_cents: Math.round(usd * 100) };
            await withdrawFromBalance(chain, receiver.trim(), opts);
            setSuccess(`$${usd.toFixed(2)} withdrawn to ${chainMeta.name}`);
            setAmount(""); setIsMax(false); onSuccess();
          } catch (e: any) { setError(e?.message || "Failed"); }
          setLoading(false);
        }} disabled={loading || !amount || parseFloat(amount) < 0.01 || !receiver.trim()}
          className="px-4 py-2 text-sm font-medium bg-white/[0.06] text-slate-300 border border-white/[0.08] rounded-lg hover:bg-white/[0.1] disabled:opacity-30 transition-all">
          {loading ? "..." : "Withdraw"}
        </button>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {success && <p className="text-green-400 text-xs">{success}</p>}
    </div>
  );
}

/** Show legacy NEAR virtual balance if > 0, with withdraw prompt */
function LegacyNearBalance({ accountId }: { accountId: string }) {
  const [nearBalance, setNearBalance] = useState<string | null>(null);
  const { callFunction, viewMethod } = useNearWallet();
  const [withdrawing, setWithdrawing] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.near";
    viewMethod({
      contractId,
      method: "get_balance",
      args: { account_id: accountId },
    }).then((raw: any) => {
      const yocto = String(raw ?? "0");
      if (yocto === "0") return;
      const near = Number(yocto) / 1e24;
      if (near >= 0.001) setNearBalance(near.toFixed(4));
    }).catch(() => {});
  }, [accountId]);

  if (!nearBalance) return null;

  return (
    <div className="glass-card rounded-2xl p-5 border border-amber-500/20 bg-amber-500/[0.04]">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span className="text-sm font-medium text-amber-300">Legacy NEAR Balance</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        You have <span className="text-white font-medium">{nearBalance} NEAR</span> in the old virtual balance.
        We recommend withdrawing it to your wallet.
      </p>
      <button
        disabled={withdrawing}
        onClick={async () => {
          setWithdrawing(true);
          try {
            const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.near";
            const raw = await viewMethod({ contractId, method: "get_balance", args: { account_id: accountId } });
            const yocto = String(raw ?? "0");
            if (yocto === "0") { setNearBalance(null); setWithdrawing(false); return; }
            await callFunction({ contractId, method: "withdraw", args: { amount: yocto }, gas: "30000000000000", deposit: "0" });
            setNearBalance(null);
          } catch (e) { console.error("Withdraw failed:", e); }
          setWithdrawing(false);
        }}
        className="px-4 py-2 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-all"
      >
        {withdrawing ? "Withdrawing..." : "Withdraw to wallet"}
      </button>
    </div>
  );
}
