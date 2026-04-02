"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useSolanaWallet } from "@/contexts/SolanaWalletContext";
import { getWalletBalance, backupWallet, restoreWallet } from "@/lib/api";
import {
  ensureRegistered,
  getAddress,
  getIntentsBalance,
  createDepositIntent,
  getDepositStatus,
  getSwapQuote,
  executeSwap,
  type DepositIntent,
  type SwapQuote,
} from "@/lib/outlayer";

const USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT_CONTRACT = "usdt.tether-token.near";
const WRAP_NEAR_CONTRACT = "wrap.near";
const USDC_DEFUSE = `nep141:${USDC_CONTRACT}`;

// ── Deposit asset config (extensible per chain) ──

interface DepositAsset {
  symbol: string;
  name: string;
  contract: string;        // FT contract (wrap.near for native NEAR)
  decimals: number;
  defuseId: string;        // for swap: "nep141:..."
  isNative?: boolean;      // needs wrap step (NEAR → wNEAR)
  isStablecoin?: boolean;  // USDC — no swap needed
}

const NEAR_ASSETS: DepositAsset[] = [
  { symbol: "USDC", name: "USDC", contract: USDC_CONTRACT, decimals: 6, defuseId: USDC_DEFUSE, isStablecoin: true },
  { symbol: "NEAR", name: "NEAR", contract: WRAP_NEAR_CONTRACT, decimals: 24, defuseId: "nep141:wrap.near", isNative: true },
  { symbol: "USDT", name: "USDT", contract: USDT_CONTRACT, decimals: 6, defuseId: "nep141:usdt.tether-token.near" },
];

const BRIDGE_CHAINS = [
  { id: "solana", name: "Solana", estSecs: 20 },
  { id: "ethereum", name: "Ethereum", estSecs: 45 },
  { id: "base", name: "Base", estSecs: 35 },
  { id: "arbitrum", name: "Arbitrum", estSecs: 25 },
  { id: "polygon", name: "Polygon", estSecs: 35 },
  { id: "optimism", name: "Optimism", estSecs: 35 },
  { id: "avalanche", name: "Avalanche", estSecs: 35 },
] as const;

const CHAIN_ID_TO_BRIDGE: Record<number, string> = {
  1: "ethereum", 8453: "base", 42161: "arbitrum",
  10: "optimism", 137: "polygon", 43114: "avalanche",
  56: "ethereum",
};

function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac)).toString();
}

function formatRaw(raw: string, decimals: number, maxFrac = 4): string {
  const val = BigInt(raw || "0");
  const whole = val / BigInt(10 ** decimals);
  const frac = val % BigInt(10 ** decimals);
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

type DepositStep = "idle" | "creating_intent" | "waiting_send" | "bridging" | "depositing" | "swapping" | "done" | "error";

export function DepositForm({ onDeposited }: { onDeposited?: () => void }) {
  const { user, isAuthenticated, refreshUser } = useAuth();
  const { accountId, callFunction, callBatch, viewMethod } = useNearWallet();
  const { solanaAddress } = useSolanaWallet();

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<DepositStep>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [bridgeIntent, setBridgeIntent] = useState<DepositIntent | null>(null);
  const [bridgeChain, setBridgeChain] = useState<string>("solana");
  const [selectedAsset, setSelectedAsset] = useState<string>("USDC");
  const [copied, setCopied] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteTimer = useRef<NodeJS.Timeout | null>(null);

  const hasSolana = !!solanaAddress || !!user?.solana_address;
  const hasNear = !!accountId;
  const hasEth = !!user?.eth_address;
  const isNearChain = bridgeChain === "near";

  const asset = NEAR_ASSETS.find((a) => a.symbol === selectedAsset) || NEAR_ASSETS[0];

  // Set default bridge chain
  useEffect(() => {
    if (hasEth && user?.eth_chain_id) {
      setBridgeChain(CHAIN_ID_TO_BRIDGE[user.eth_chain_id] || "ethereum");
    } else if (hasNear) {
      setBridgeChain("near");
    } else if (hasSolana) {
      setBridgeChain("solana");
    } else {
      setBridgeChain("ethereum");
    }
  }, [hasSolana, hasNear, hasEth, user?.eth_chain_id]);

  // Reset asset when chain changes
  useEffect(() => {
    setSelectedAsset("USDC");
    setSwapQuote(null);
    setWalletBalance(null);
  }, [bridgeChain]);

  // Fetch wallet balance for selected asset (NEAR chain only)
  useEffect(() => {
    if (!isNearChain || !accountId || !viewMethod) { setWalletBalance(null); return; }

    if (asset.isNative) {
      // Native NEAR balance via RPC view_account
      fetch("https://rpc.mainnet.fastnear.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } }),
      }).then((r) => r.json()).then((data) => {
        const yocto = data?.result?.amount || "0";
        // Reserve 0.05 NEAR for gas
        const available = BigInt(yocto) - BigInt("50000000000000000000000");
        if (available > BigInt(0)) {
          setWalletBalance(formatRaw(available.toString(), 24));
        } else {
          setWalletBalance("0");
        }
      }).catch(() => setWalletBalance(null));
    } else {
      viewMethod({
        contractId: asset.contract,
        method: "ft_balance_of",
        args: { account_id: accountId },
      }).then((raw) => {
        setWalletBalance(formatRaw(String(raw ?? "0"), asset.decimals));
      }).catch(() => setWalletBalance(null));
    }
  }, [isNearChain, accountId, viewMethod, asset.contract, asset.decimals, asset.isNative]);

  // Debounced swap quote for non-stablecoin assets
  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setSwapQuote(null);

    if (!isNearChain || asset.isStablecoin || !amount || parseFloat(amount) <= 0) return;

    setQuoteLoading(true);
    quoteTimer.current = setTimeout(async () => {
      try {
        const apiKey = localStorage.getItem("nearfm_outlayer_api_key");
        if (!apiKey) { setQuoteLoading(false); return; }
        const rawIn = toMinimalUnits(amount, asset.decimals);
        const quote = await getSwapQuote(apiKey, asset.defuseId, USDC_DEFUSE, rawIn);
        setSwapQuote(quote);
      } catch { setSwapQuote(null); }
      setQuoteLoading(false);
    }, 500);

    return () => { if (quoteTimer.current) clearTimeout(quoteTimer.current); };
  }, [amount, asset, isNearChain]);

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

  // ── NEAR chain deposit (USDC / USDT / NEAR) ──
  async function handleNearChainDeposit() {
    if (!user || !accountId || !callFunction) return;
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) { setError("Enter amount"); setStep("error"); return; }
    setError(""); setResult(null);

    try {
      const apiKey = await ensureWallet();
      const { address: agentHex } = await getAddress(apiKey);
      const rawAmount = toMinimalUnits(amount, asset.decimals);

      if (asset.isNative) {
        // NEAR: wrap + transfer in single wallet popup → then swap
        setStep("depositing");
        await callBatch([
          {
            contractId: WRAP_NEAR_CONTRACT,
            method: "near_deposit",
            args: {},
            gas: "10000000000000",
            deposit: rawAmount,
          },
          {
            contractId: WRAP_NEAR_CONTRACT,
            method: "ft_transfer_call",
            args: { receiver_id: "intents.near", amount: rawAmount, msg: agentHex },
            gas: "100000000000000",
            deposit: "1",
          },
        ]);

        // Swap wNEAR → USDC (use actual intents balance to avoid rounding mismatch)
        setStep("swapping");
        let swapOk = false;
        for (let i = 0; i < 3; i++) {
          try {
            const bal = await getIntentsBalance(apiKey, asset.contract);
            const actualAmount = bal.balance || "0";
            if (actualAmount === "0") throw new Error("No balance to swap");
            const q = await getSwapQuote(apiKey, asset.defuseId, USDC_DEFUSE, actualAmount);
            await executeSwap(apiKey, asset.defuseId, USDC_DEFUSE, actualAmount, q.min_amount_out);
            const usdcOut = (parseInt(q.amount_out) / 1e6).toFixed(2);
            setResult(`+$${usdcOut} deposited (${amount} NEAR)`);
            swapOk = true;
            break;
          } catch {
            if (i < 2) await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (!swapOk) {
          setError("Deposit received but swap failed. Check internal balances on the Balance page.");
          setStep("error");
          return;
        }
      } else if (asset.isStablecoin) {
        // USDC: direct deposit (existing flow)
        setStep("depositing");
        await callFunction({
          contractId: asset.contract,
          method: "ft_transfer_call",
          args: { receiver_id: "intents.near", amount: rawAmount, msg: agentHex },
          gas: "100000000000000",
          deposit: "1",
        });
        setResult(`+$${val.toFixed(2)} deposited`);
      } else {
        // USDT: transfer → swap
        setStep("depositing");
        await callFunction({
          contractId: asset.contract,
          method: "ft_transfer_call",
          args: { receiver_id: "intents.near", amount: rawAmount, msg: agentHex },
          gas: "100000000000000",
          deposit: "1",
        });

        // Swap USDT → USDC (use actual intents balance)
        setStep("swapping");
        let swapOk = false;
        for (let i = 0; i < 3; i++) {
          try {
            const bal = await getIntentsBalance(apiKey, asset.contract);
            const actualAmount = bal.balance || "0";
            if (actualAmount === "0") throw new Error("No balance to swap");
            const q = await getSwapQuote(apiKey, asset.defuseId, USDC_DEFUSE, actualAmount);
            await executeSwap(apiKey, asset.defuseId, USDC_DEFUSE, actualAmount, q.min_amount_out);
            const usdcOut = (parseInt(q.amount_out) / 1e6).toFixed(2);
            setResult(`+$${usdcOut} deposited (${amount} ${asset.symbol})`);
            swapOk = true;
            break;
          } catch {
            if (i < 2) await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (!swapOk) {
          setError("Deposit received but swap failed. Check internal balances on the Balance page.");
          setStep("error");
          return;
        }
      }

      setStep("done");
      onDeposited?.();
      await refreshUser();
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("User rejected") || msg.includes("cancelled")) { setStep("idle"); return; }
      setError(msg); setStep("error");
    }
  }

  // ── Bridge deposit (cross-chain USDC) ──
  async function handleBridgeDeposit() {
    if (!user) return;
    const usd = parseFloat(amount);
    if (isNaN(usd) || usd < 0.13) { setError("Minimum $0.13 (bridge fee)"); setStep("error"); return; }
    setError(""); setResult(null);
    try {
      setStep("creating_intent");
      const apiKey = await ensureWallet();
      const rawAmount = toMinimalUnits(amount, 6);
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
  const needsSwap = isNearChain && !asset.isStablecoin;
  const isIdle = step === "idle" || step === "error" || step === "done";
  const estimatedUsdc = swapQuote ? (parseInt(swapQuote.amount_out) / 1e6).toFixed(2) : null;

  if (!isAuthenticated) return null;

  return (
    <div className="space-y-3">
      {/* Chain selector */}
      {isIdle && (
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

      {/* Asset selector (NEAR chain only) */}
      {isNearChain && isIdle && (
        <div>
          <div className="text-xs text-slate-500 mb-1.5">Asset:</div>
          <div className="flex gap-1.5">
            {NEAR_ASSETS.map((a) => (
              <button key={a.symbol} onClick={() => setSelectedAsset(a.symbol)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  selectedAsset === a.symbol
                    ? "bg-white/[0.1] text-slate-200 border-white/[0.15]"
                    : "bg-white/[0.04] text-slate-500 border-white/[0.06] hover:bg-white/[0.08]"
                }`}
              >{a.symbol}</button>
            ))}
          </div>
        </div>
      )}

      {/* Wallet balance */}
      {isNearChain && walletBalance !== null && (
        <div className="text-xs text-slate-500">
          Wallet balance: <span className="text-slate-400 font-medium">{walletBalance} {asset.symbol}</span>
        </div>
      )}

      {/* Amount input */}
      <div className="relative">
        {isNearChain && !asset.isStablecoin ? (
          <>
            <input
              type="number" min="0" step="any" placeholder={asset.symbol === "NEAR" ? "1.0" : "5.00"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!isIdle}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2.5 pl-3 pr-16 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-white/[0.2] transition-colors"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{asset.symbol}</span>
          </>
        ) : (
          <>
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
            <input
              type="number" min="0.01" step="0.01" placeholder="1.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!isIdle}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2.5 pl-7 pr-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-white/[0.2] transition-colors"
            />
          </>
        )}
      </div>

      {/* Quick amounts */}
      <div className="flex gap-2">
        {(isNearChain && !asset.isStablecoin
          ? ["0.5", "1", "5", "10"]
          : ["1", "5", "10", "25"]
        ).map((v) => (
          <button key={v} onClick={() => setAmount(v)}
            className="flex-1 py-1.5 rounded-lg text-xs bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08] transition-all"
          >{isNearChain && !asset.isStablecoin ? `${v} ${asset.symbol}` : `$${v}`}</button>
        ))}
      </div>

      {/* Swap quote */}
      {needsSwap && amount && parseFloat(amount) > 0 && (
        <div className="text-xs text-slate-400">
          {quoteLoading ? "Getting quote..." : estimatedUsdc ? (
            <span>≈ <span className="text-green-400 font-medium">${estimatedUsdc}</span> USDC after swap</span>
          ) : "Enter amount for quote"}
        </div>
      )}

      {/* Bridge quote */}
      {step === "waiting_send" && bridgeIntent && (
        <div className="bg-purple-500/[0.08] border border-purple-500/20 rounded-xl p-4 space-y-3">
          <div className="text-sm font-medium text-purple-300">Send USDC from {chainInfo.name} wallet</div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">You send:</span>
            <span className="text-white font-medium">{amount} USDC</span>
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
            <div className="text-xs text-amber-400/80 mt-2">Important: send exactly {amount} USDC on {chainInfo.name}. A different amount may result in lost funds.</div>
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

      {/* Progress states */}
      {(step === "bridging" || step === "depositing" || step === "swapping") && (
        <div className="bg-cyan-500/[0.08] border border-cyan-500/20 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 animate-spin text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <div>
            <div className="text-sm text-cyan-300">
              {step === "depositing" ? "Depositing to intents..." :
               step === "swapping" ? "Swapping to USDC..." :
               `Bridging from ${chainInfo.name}...`}
            </div>
            <div className="text-[11px] text-slate-500">
              {step === "swapping" ? "Gasless swap, ~10 seconds" :
               step === "bridging" ? `Usually takes ~${chainInfo.estSecs} seconds` :
               "Confirm in your wallet"}
            </div>
          </div>
        </div>
      )}

      {/* Main button */}
      {step !== "waiting_send" && step !== "bridging" && step !== "depositing" && step !== "swapping" && (
        <button
          onClick={isNearChain ? handleNearChainDeposit : handleBridgeDeposit}
          disabled={step === "creating_intent" || !amount || parseFloat(amount) <= 0 || (needsSwap && !swapQuote)}
          className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {step === "creating_intent" ? "Preparing..." :
           isNearChain && needsSwap && estimatedUsdc
             ? `Deposit ${amount} ${asset.symbol} → ~$${estimatedUsdc} USDC`
             : isNearChain
               ? `Deposit ${asset.symbol}`
               : `Deposit via ${chainInfo.name}`}
        </button>
      )}

      {error && <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">{error}</div>}
      {result && step === "done" && <div className="text-green-400 text-xs bg-green-400/[0.08] rounded-lg p-3">{result}</div>}
    </div>
  );
}
