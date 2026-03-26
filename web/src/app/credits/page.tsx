"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useSolanaWallet } from "@/contexts/SolanaWalletContext";
import { creditTopup, creditHistory, creditUsage, type TopupRecord, type UsageRecord } from "@/lib/api";
import { ensureRegistered, getAddress, createCheck, createSolanaDepositIntent, getSolanaDepositStatus, saveExternalAddresses } from "@/lib/outlayer";

const USDC_CONTRACT =
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT_CONTRACT = "usdt.tether-token.near";
const DECIMALS = 6;

const TOKENS: Record<string, { contract: string; label: string }> = {
  USDC: { contract: USDC_CONTRACT, label: "USDC" },
  USDT: { contract: USDT_CONTRACT, label: "USDT" },
};

// Pending state for recovery if user closes tab mid-flow
const PENDING_KEY = "nearfm_credits_pending";

interface PendingState {
  token: string;
  amount: string;
  step: "deposited" | "check_created";
  checkKey?: string;
}

function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return result.toString();
}

/** Format USDC raw amount (6 decimals) — show enough digits to see the fee */
function formatUsdcAmount(raw: string): string {
  const val = parseInt(raw);
  const usd = val / 1e6;
  // For whole dollars (e.g. 1.000000) show 2 digits
  // For small amounts show enough to see the difference
  const s = usd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  // But cap at 4 decimal places for readability
  const parts = s.split(".");
  if (!parts[1]) return parts[0];
  return parts[0] + "." + parts[1].slice(0, Math.max(2, parts[1].length > 4 ? 4 : parts[1].length));
}

export default function CreditsPage() {
  const {
    user,
    isAuthenticated,
    loading: authLoading,
    refreshUser,
    promptSignIn,
  } = useAuth();
  const { accountId, wallet, callFunction, connectWallet, viewMethod } = useNearWallet();
  const { solanaAddress } = useSolanaWallet();

  // Determine which payment method to use
  const hasNearWallet = !!wallet && !!accountId;
  const hasSolanaWallet = !!solanaAddress || !!user?.solana_address;
  const hasAnyWallet = hasNearWallet || hasSolanaWallet;

  const [selectedToken, setSelectedToken] = useState<"USDC" | "USDT">("USDC");
  const [amountUsd, setAmountUsd] = useState("");
  const [step, setStep] = useState<
    "idle" | "quote" | "depositing" | "creating_check" | "claiming" | "done" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    credits_added: number;
    new_balance: number;
  } | null>(null);
  const [history, setHistory] = useState<TopupRecord[]>([]);
  const [usageHistory, setUsageHistory] = useState<UsageRecord[]>([]);
  const [tokenBalances, setTokenBalances] = useState<{ USDC: string | null; USDT: string | null }>({ USDC: null, USDT: null });

  // Fetch FT balances
  useEffect(() => {
    if (!accountId) return;
    const fetchBalance = async (token: "USDC" | "USDT") => {
      try {
        const raw = await viewMethod({
          contractId: TOKENS[token].contract,
          method: "ft_balance_of",
          args: { account_id: accountId },
        });
        const val = BigInt(String(raw ?? "0"));
        const whole = val / BigInt(10 ** DECIMALS);
        const frac = val % BigInt(10 ** DECIMALS);
        const formatted = `${whole}.${frac.toString().padStart(DECIMALS, "0").replace(/0+$/, "") || "0"}`;
        return formatted;
      } catch {
        return null;
      }
    };
    Promise.all([fetchBalance("USDC"), fetchBalance("USDT")]).then(([usdc, usdt]) => {
      setTokenBalances({ USDC: usdc, USDT: usdt });
    }).catch(() => {});
  }, [accountId, viewMethod, result]);

  // Load history
  useEffect(() => {
    if (isAuthenticated) {
      creditHistory(20).then(setHistory).catch(() => {});
      creditUsage(20).then(setUsageHistory).catch(() => {});
    }
  }, [isAuthenticated, result]);

  // Resume pending flow on mount
  const resumePending = useCallback(
    async (pending: PendingState) => {
      if (!user) return;
      const accountIdToCredit = user.near_account_id || user.slug;

      try {
        if (pending.step === "deposited") {
          // Deposit done but check not created — resume from createCheck
          setStep("creating_check");
          const apiKey = await ensureRegistered();
          const check = await createCheck(apiKey, pending.token, pending.amount);

          pending.step = "check_created";
          pending.checkKey = check.check_key;
          localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        }

        if (pending.step === "check_created" && pending.checkKey) {
          setStep("claiming");
          const res = await creditTopup(pending.checkKey, accountIdToCredit);
          setResult(res);
          setStep("done");
          localStorage.removeItem(PENDING_KEY);
          await refreshUser();
        }
      } catch (e: any) {
        setError(e.message || "Failed to resume top-up");
        setStep("error");
        localStorage.removeItem(PENDING_KEY);
      }
    },
    [user, refreshUser]
  );

  useEffect(() => {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw || !user) return;
    try {
      const pending: PendingState = JSON.parse(raw);
      resumePending(pending);
    } catch {
      localStorage.removeItem(PENDING_KEY);
    }
  }, [user, resumePending]);

  // Solana USDC deposit via OutLayer 1Click bridge
  const [solanaIntent, setSolanaIntent] = useState<{ intent_id: string; deposit_address: string; amount_out: string; amount: string } | null>(null);
  const [solanaApiKey, setSolanaApiKey] = useState<string | null>(null);

  // Step 1: Get quote from OutLayer — show deposit address + expected amount
  async function handleSolanaGetQuote() {
    const solAddr = solanaAddress || user?.solana_address;
    if (!user || !solAddr) return;

    const usd = parseFloat(amountUsd);
    if (isNaN(usd) || usd < 0.01) {
      setError("Enter an amount");
      setStep("error");
      return;
    }

    setError("");
    setResult(null);

    try {
      setStep("depositing");
      const apiKey = await ensureRegistered();
      setSolanaApiKey(apiKey);
      const rawAmount = toMinimalUnits(amountUsd, DECIMALS);
      const intent = await createSolanaDepositIntent(apiKey, rawAmount, "USDC", solAddr);
      const creditsAfterFee = Math.floor(parseInt(intent.amount_out) / 10000);

      if (creditsAfterFee < 1) {
        setError("Amount too small — no credits after bridge fee");
        setStep("error");
        return;
      }

      setSolanaIntent(intent);
      setStep("quote"); // Show quote + address, wait for user to send
    } catch (e: any) {
      setError(e?.message || "Failed to get quote");
      setStep("error");
    }
  }

  // Step 2: User sent USDC — start polling for bridge completion
  async function handleSolanaConfirmSent() {
    if (!solanaIntent || !solanaApiKey || !user) return;

    try {
      setStep("creating_check");
      let bridged = false;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await getSolanaDepositStatus(solanaApiKey, solanaIntent.intent_id);
        if (status.status === "success") {
          bridged = true;
          break;
        }
        if (status.status === "failed" || status.status === "expired") {
          throw new Error(`Bridge ${status.status}`);
        }
      }
      if (!bridged) throw new Error("Bridge timeout — try again");

      // Create payment check from intents balance
      const check = await createCheck(solanaApiKey, USDC_CONTRACT, solanaIntent.amount_out || solanaIntent.amount);

      // Claim credits
      setStep("claiming");
      const accountIdToCredit = user.near_account_id || user.slug;
      const res = await creditTopup(check.check_key, accountIdToCredit);

      setResult(res);
      setStep("done");
      setSolanaIntent(null);
      setSolanaApiKey(null);
      await refreshUser();
    } catch (e: any) {
      setError(e?.message || "Unknown error");
      setStep("error");
      setSolanaIntent(null);
      setSolanaApiKey(null);
    }
  }

  // NEAR USDC deposit via ft_transfer_call
  async function handleTopup() {
    if (!user || !wallet || !accountId) return;

    const usd = parseFloat(amountUsd);
    if (isNaN(usd) || usd < 0.01) {
      setError("Minimum amount is $0.01");
      setStep("error");
      return;
    }

    setError("");
    setResult(null);

    try {
      // 1. Ensure OutLayer wallet exists
      setStep("depositing");
      const apiKey = await ensureRegistered();

      // Get OutLayer wallet address (hex account on intents.near)
      const { address: agentHex } = await getAddress(apiKey);

      // 2. ft_transfer_call to intents.near with msg = agent hex address
      const tokenContract = TOKENS[selectedToken].contract;
      const rawAmount = toMinimalUnits(amountUsd, DECIMALS);

      await callFunction({
        contractId: tokenContract,
        method: "ft_transfer_call",
        args: {
          receiver_id: "intents.near",
          amount: rawAmount,
          msg: agentHex,
        },
        gas: "100000000000000", // 100 TGas
        deposit: "1", // 1 yoctoNEAR
      });

      // Save pending state in case user closes tab after deposit
      const pending: PendingState = {
        token: tokenContract,
        amount: rawAmount,
        step: "deposited",
      };
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

      // 3. Create payment check from agent's intents balance
      setStep("creating_check");
      const check = await createCheck(apiKey, tokenContract, rawAmount);

      pending.step = "check_created";
      pending.checkKey = check.check_key;
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

      // 4. Send check to server for credit
      setStep("claiming");
      const accountIdToCredit = user.near_account_id || user.slug;
      const res = await creditTopup(check.check_key, accountIdToCredit);

      setResult(res);
      setStep("done");
      localStorage.removeItem(PENDING_KEY);
      await refreshUser();
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      // If user rejected the transaction in wallet, just reset
      if (msg.includes("User rejected") || msg.includes("User cancelled")) {
        setStep("idle");
        return;
      }
      setError(msg);
      setStep("error");
    }
  }

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
          <h1 className="text-3xl font-bold text-gradient inline-block">
            Credits
          </h1>
          <p className="text-slate-400">
            Top up credits to generate AI songs. 100 credits = $1.
          </p>
        </div>

        {/* Balance */}
        {isAuthenticated && user && (
          <div className="glass-card rounded-2xl p-5 text-center">
            <div className="text-sm text-slate-400 mb-1">Your balance</div>
            <div className="text-3xl font-bold text-slate-100">
              {user.credit_balance.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              purchased credits ({(user.credit_balance / 100).toFixed(2)} USD)
            </div>
            {user.daily_credits_remaining > 0 && (
              <div className="text-xs text-cyan-400 mt-1">
                + {user.daily_credits_remaining} daily premium credits
              </div>
            )}
          </div>
        )}

        {/* Top-up form */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="text-sm font-medium text-slate-300">Add Credits</div>

          {!isAuthenticated ? (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">
                Sign in to top up credits
              </p>
              <button
                onClick={promptSignIn}
                className="btn-primary px-6 py-2 rounded-xl text-sm"
              >
                Sign In
              </button>
            </div>
          ) : !hasAnyWallet ? (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">
                Connect a wallet to deposit tokens
              </p>
              <button
                onClick={connectWallet}
                className="btn-primary px-6 py-2 rounded-xl text-sm"
              >
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

              {/* Wallet token balance (NEAR only) */}
              {hasNearWallet && tokenBalances[selectedToken] !== null && (
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-slate-500">Wallet balance:</span>
                  <span className={`font-medium ${parseFloat(tokenBalances[selectedToken]!) > 0 ? "text-slate-300" : "text-red-400"}`}>
                    {tokenBalances[selectedToken]} {selectedToken}
                  </span>
                </div>
              )}

              {/* Amount input */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                  $
                </span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="1.00"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  disabled={
                    step !== "idle" && step !== "error" && step !== "done"
                  }
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2.5 pl-7 pr-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-white/[0.2] transition-colors"
                />
              </div>

              {amountUsd && parseFloat(amountUsd) > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">
                    ≈ {Math.floor(parseFloat(amountUsd) * 100).toLocaleString()}{" "}
                    credits ({Math.floor((parseFloat(amountUsd) * 100) / 12)}{" "}
                    songs){!hasNearWallet && hasSolanaWallet && " · small bridge fee applies"}
                  </div>
                  {hasNearWallet && tokenBalances[selectedToken] !== null && parseFloat(amountUsd) > parseFloat(tokenBalances[selectedToken]!) && (
                    <div className="text-xs text-red-400">
                      Insufficient {selectedToken} balance in your wallet
                    </div>
                  )}
                </div>
              )}

              {/* Quick amounts */}
              <div className="flex gap-2">
                {["1", "5", "10", "25"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmountUsd(v)}
                    className="flex-1 py-1.5 rounded-lg text-xs bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08] transition-all"
                  >
                    ${v}
                  </button>
                ))}
              </div>

              {/* Action button */}
              {/* Solana quote view */}
              {step === "quote" && solanaIntent && (
                <div className="bg-purple-500/[0.08] border border-purple-500/20 rounded-xl p-4 space-y-3">
                  <div className="text-sm font-medium text-purple-300">Send USDC from your Solana wallet</div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">You send:</span>
                    <span className="text-white font-medium">{amountUsd} USDC</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">You receive (after fee):</span>
                    <span className="text-green-400 font-medium">{formatUsdcAmount(solanaIntent.amount_out)} USDC</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Credits:</span>
                    <span className="text-white font-medium">{Math.floor(parseInt(solanaIntent.amount_out) / 10000)} ({Math.floor(parseInt(solanaIntent.amount_out) / 10000 / 12)} songs)</span>
                  </div>
                  {Math.floor(parseInt(solanaIntent.amount_out) / 10000) < 12 && (
                    <div className="text-[11px] text-amber-400">
                      Not enough for 1 song (12 credits). Consider a larger amount.
                    </div>
                  )}
                  <div className="border-t border-white/[0.06] pt-3">
                    <div className="text-xs text-slate-400 mb-1.5">Send to this Solana address:</div>
                    <div
                      className="bg-black/30 rounded-lg px-3 py-2 font-mono text-xs text-slate-200 break-all cursor-pointer hover:bg-black/40 transition"
                      onClick={() => { navigator.clipboard.writeText(solanaIntent.deposit_address); }}
                      title="Click to copy"
                    >
                      {solanaIntent.deposit_address}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-1">Click to copy</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSolanaConfirmSent}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 transition-all"
                    >
                      I&apos;ve sent it
                    </button>
                    <button
                      onClick={() => { setStep("idle"); setSolanaIntent(null); }}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-400 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Main action button (hidden during quote/polling) */}
              {step !== "quote" && (
                <button
                  onClick={!hasNearWallet && hasSolanaWallet ? handleSolanaGetQuote : handleTopup}
                  disabled={
                    step === "depositing" ||
                    step === "creating_check" ||
                    step === "claiming" ||
                    !amountUsd ||
                    parseFloat(amountUsd) < 0.01
                  }
                  className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {step === "depositing" && (hasSolanaWallet && !hasNearWallet ? "Getting quote..." : "Waiting for wallet...")}
                  {step === "creating_check" && "Waiting for deposit..."}
                  {step === "claiming" && "Claiming credits..."}
                  {(step === "idle" || step === "error" || step === "done") &&
                    "Add Credits"}
                </button>
              )}

              {/* Polling status for Solana */}
              {step === "creating_check" && solanaIntent && (
                <div className="bg-cyan-500/[0.08] border border-cyan-500/20 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm text-cyan-300">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Waiting for your USDC deposit...
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Bridge takes ~15 seconds after your transaction confirms.
                  </div>
                </div>
              )}

              {/* Status messages */}
              {error && (
                <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">
                  {error}
                </div>
              )}

              {result && step === "done" && (
                <div className="text-green-400 text-xs bg-green-400/[0.08] rounded-lg p-3">
                  +{result.credits_added.toLocaleString()} credits added. New
                  balance: {result.new_balance.toLocaleString()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pricing info */}
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="text-sm font-medium text-slate-300">Pricing</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="text-slate-400">1 credit</div>
            <div className="text-slate-300">$0.01</div>
            <div className="text-slate-400">1 song generation</div>
            <div className="text-slate-300">12 credits ($0.12)</div>
            <div className="text-slate-400">Accepted tokens</div>
            <div className="text-slate-300">USDC, USDT</div>
          </div>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <div className="text-sm font-medium text-slate-300">
              Top-up History
            </div>
            <div className="space-y-2">
              {history.map((h, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center text-xs"
                >
                  <div className="text-slate-400">
                    {new Date(h.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-slate-400">
                    {h.token === USDC_CONTRACT ? "USDC" : "USDT"}
                  </div>
                  <div className="text-green-400">
                    +{h.credits_added.toLocaleString()} credits
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Usage History */}
        {usageHistory.length > 0 && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <div className="text-sm font-medium text-slate-300">
              Usage History
            </div>
            <div className="space-y-2">
              {usageHistory.map((u, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center text-xs"
                >
                  <div className="text-slate-400">
                    {new Date(u.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-slate-400">
                    {u.action.replace(/_/g, " ")}
                  </div>
                  <div
                    className={
                      u.credits_spent < 0
                        ? "text-green-400"
                        : "text-orange-400"
                    }
                  >
                    {u.credits_spent < 0 ? "+" : "-"}
                    {Math.abs(u.credits_spent)} credits
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center">
          <Link
            href="/"
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
