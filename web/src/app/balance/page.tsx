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
  createSolanaDepositIntent,
  getSolanaDepositStatus,
  type SolanaDepositIntent,
} from "@/lib/outlayer";

const USDC_CONTRACT = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DECIMALS = 6;

function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac)).toString();
}

type DepositStep = "idle" | "creating_intent" | "waiting_send" | "bridging" | "claiming" | "done" | "error";

export default function BalancePageWrapper() {
  return <Suspense><BalancePage /></Suspense>;
}

function BalancePage() {
  const { user, isAuthenticated, loading: authLoading, refreshUser, promptSignIn } = useAuth();
  const { accountId, callFunction } = useNearWallet();
  const { solanaAddress } = useSolanaWallet();

  const searchParams = useSearchParams();
  const [balanceFormatted, setBalanceFormatted] = useState("0.00");
  const [amountUsd, setAmountUsd] = useState(searchParams.get("amount") || "");
  const [step, setStep] = useState<DepositStep>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);

  // Solana deposit state
  const [solanaIntent, setSolanaIntent] = useState<SolanaDepositIntent | null>(null);
  const [copied, setCopied] = useState(false);

  // Ensure user has OutLayer wallet.
  // Priority: server (authoritative) → localStorage → register new.
  const ensureWallet = useCallback(async (): Promise<string> => {
    // 1. Try restore from server (authoritative source)
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

    // 2. Try localStorage (no server backup yet)
    const localKey = localStorage.getItem("nearfm_outlayer_api_key");
    if (localKey) {
      getAddress(localKey).then(({ address }) => backupWallet(localKey, address)).catch(() => {});
      return localKey;
    }

    // 3. Register new OutLayer wallet
    const apiKey = await ensureRegistered();

    // 5. Backup to server
    try {
      const { address } = await getAddress(apiKey);
      await backupWallet(apiKey, address);
    } catch (e) {
      console.warn("Wallet backup failed:", e);
    }

    return apiKey;
  }, []);

  // Fetch balance
  const fetchBalance = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const b = await getWalletBalance();
      setBalanceFormatted(b.balance_usdc_formatted);
      window.dispatchEvent(new Event("nearfm_balance_updated"));
    } catch {
      setBalanceFormatted("0.00");
    }
  }, [isAuthenticated]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  // Determine deposit method
  const hasSolana = !!solanaAddress || !!user?.solana_address;
  const hasNear = !!accountId;

  // ── NEAR deposit ──
  async function handleNearDeposit() {
    if (!user || !accountId || !callFunction) return;

    const usd = parseFloat(amountUsd);
    if (isNaN(usd) || usd < 0.01) {
      setError("Minimum $0.01");
      setStep("error");
      return;
    }

    setError("");
    setResult(null);

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

      // ft_transfer_call sends USDC directly to user's OutLayer intents balance.
      // No payment check needed — money is already there.

      setResult(`+$${usd.toFixed(2)} deposited`);
      setStep("done");
      await fetchBalance();
      await refreshUser();
    } catch (e: any) {
      const msg = e?.message || "Unknown error";
      if (msg.includes("User rejected") || msg.includes("cancelled")) {
        setStep("idle");
        return;
      }
      setError(msg);
      setStep("error");
    }
  }

  // ── Solana deposit ──
  async function handleSolanaDeposit() {
    if (!user) return;

    const usd = parseFloat(amountUsd);
    if (isNaN(usd) || usd < 0.13) {
      setError("Minimum $0.13 for Solana (bridge fee applies)");
      setStep("error");
      return;
    }

    setError("");
    setResult(null);

    try {
      setStep("creating_intent");
      const apiKey = await ensureWallet();
      const solAddr = solanaAddress || user.solana_address || "";
      const rawAmount = toMinimalUnits(amountUsd, DECIMALS);
      const intent = await createSolanaDepositIntent(apiKey, rawAmount, "USDC", solAddr);
      setSolanaIntent(intent);
      setStep("waiting_send");
    } catch (e: any) {
      setError(e?.message || "Failed to create deposit");
      setStep("error");
    }
  }

  async function handleSolanaConfirmSent() {
    if (!solanaIntent) return;

    try {
      setStep("bridging");
      const apiKey = await ensureWallet();

      // Poll for bridge completion
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await getSolanaDepositStatus(apiKey, solanaIntent.intent_id);
        if (status.status === "success") {
          setResult(`+$${(parseInt(solanaIntent.amount_out) / 1e6).toFixed(2)} deposited`);
          setStep("done");
          setSolanaIntent(null);
          await fetchBalance();
          return;
        }
        if (status.status === "failed" || status.status === "expired") {
          throw new Error(`Bridge ${status.status}`);
        }
      }
      throw new Error("Bridge timeout");
    } catch (e: any) {
      setError(e?.message || "Bridge failed");
      setStep("error");
      setSolanaIntent(null);
    }
  }

  function handleDeposit() {
    if (hasNear) {
      handleNearDeposit();
    } else if (hasSolana) {
      handleSolanaDeposit();
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
          <h1 className="text-3xl font-bold text-gradient inline-block">Balance</h1>
          <p className="text-slate-400">
            Your USDC balance for tips, credits, and bounties.
          </p>
        </div>

        {/* Balance display */}
        {isAuthenticated && user && (
          <div className="glass-card rounded-2xl p-6 text-center">
            <div className="text-sm text-slate-400 mb-1">Your balance</div>
            <div className="text-4xl font-bold text-white">
              ${balanceFormatted}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              USDC on Intents (on-chain)
            </div>
            {user.credit_balance > 0 && (
              <div className="text-xs text-cyan-400 mt-1">
                + {user.credit_balance} legacy credits
              </div>
            )}
          </div>
        )}

        {/* Deposit form */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="text-sm font-medium text-slate-300">Add Funds</div>

          {!isAuthenticated ? (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">Sign in to manage your balance</p>
              <button onClick={promptSignIn} className="btn-primary px-6 py-2 rounded-xl text-sm">
                Sign In
              </button>
            </div>
          ) : (
            <>
              {/* Amount input */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="1.00"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  disabled={step !== "idle" && step !== "error" && step !== "done"}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2.5 pl-7 pr-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-white/[0.2] transition-colors"
                />
              </div>

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

              {amountUsd && parseFloat(amountUsd) > 0 && (
                <div className="text-xs text-slate-500">
                  {hasNear ? "Deposit via NEAR USDC" : hasSolana ? "Deposit via Solana USDC" : "Connect a wallet to deposit"}
                </div>
              )}

              {/* Solana quote + address */}
              {step === "waiting_send" && solanaIntent && (
                <div className="bg-purple-500/[0.08] border border-purple-500/20 rounded-xl p-4 space-y-3">
                  <div className="text-sm font-medium text-purple-300">Send USDC from Solana wallet</div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">You send:</span>
                    <span className="text-white font-medium">{amountUsd} USDC</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">You receive:</span>
                    <span className="text-green-400 font-medium">{(parseInt(solanaIntent.amount_out) / 1e6).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} USDC</span>
                  </div>
                  <div className="border-t border-white/[0.06] pt-3">
                    <div className="text-xs text-slate-400 mb-1.5">Send to this Solana address:</div>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 bg-black/30 rounded-lg px-3 py-2 font-mono text-xs text-slate-200 break-all cursor-pointer hover:bg-black/40 transition"
                        onClick={() => { navigator.clipboard.writeText(solanaIntent.deposit_address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                      >{solanaIntent.deposit_address}</div>
                      <button onClick={() => { navigator.clipboard.writeText(solanaIntent.deposit_address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        className="shrink-0 px-3 py-2 text-xs font-medium text-slate-300 bg-white/[0.06] border border-white/[0.1] rounded-lg hover:bg-white/[0.1] transition-all">
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div className="text-xs text-amber-400/80 mt-2">Important: send exactly {amountUsd} USDC. A different amount may result in lost funds.</div>
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

              {/* Bridging spinner */}
              {step === "bridging" && (
                <div className="bg-cyan-500/[0.08] border border-cyan-500/20 rounded-xl p-4 flex items-center gap-3">
                  <svg className="w-5 h-5 animate-spin text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <div>
                    <div className="text-sm text-cyan-300">Bridging from Solana...</div>
                    <div className="text-[11px] text-slate-500">Usually takes ~15 seconds</div>
                  </div>
                </div>
              )}

              {/* Main deposit button (hidden during solana flow) */}
              {step !== "waiting_send" && step !== "bridging" && (
                <button
                  onClick={handleDeposit}
                  disabled={
                    step === "creating_intent" || step === "claiming" ||
                    !amountUsd || parseFloat(amountUsd) < 0.01 ||
                    (!hasNear && !hasSolana)
                  }
                  className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {step === "creating_intent" ? "Preparing..." :
                   step === "claiming" ? "Finalizing..." : "Deposit"}
                </button>
              )}

              {!hasNear && !hasSolana && isAuthenticated && (
                <div className="text-xs text-amber-400 text-center">
                  Connect a wallet (NEAR or Solana) to deposit funds.
                </div>
              )}

              {/* Status messages */}
              {error && (
                <div className="text-red-400 text-xs bg-red-400/[0.08] rounded-lg p-3">{error}</div>
              )}
              {result && step === "done" && (
                <div className="text-green-400 text-xs bg-green-400/[0.08] rounded-lg p-3">{result}</div>
              )}
            </>
          )}
        </div>

        {/* Legacy NEAR virtual balance — prompt withdrawal */}
        {isAuthenticated && hasNear && accountId && (
          <LegacyNearBalance accountId={accountId} />
        )}

        {/* Withdraw */}
        {isAuthenticated && parseFloat(balanceFormatted) > 0 && (
          <WithdrawSection
            hasSolana={hasSolana}
            hasNear={hasNear}
            solanaAddress={solanaAddress || user?.solana_address || ""}
            nearAccountId={accountId || user?.near_account_id || ""}
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
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Withdraw USDC to wallet on any chain */
function WithdrawSection({ hasSolana, hasNear, solanaAddress, nearAccountId, onSuccess }: {
  hasSolana: boolean; hasNear: boolean; solanaAddress: string; nearAccountId: string; onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Auto-select chain and address
  const chain = hasNear ? "near" : hasSolana ? "solana" : "";
  const receiver = hasNear ? nearAccountId : hasSolana ? solanaAddress : "";

  if (!chain || !receiver) return null;

  const handleWithdraw = async () => {
    const usd = parseFloat(amount);
    if (isNaN(usd) || usd < 1) { setError("Minimum withdrawal is $1.00"); return; }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await withdrawFromBalance(chain, receiver, { amount_cents: Math.round(usd * 100) });
      setSuccess(`$${usd.toFixed(2)} sent to ${chain === "near" ? nearAccountId : solanaAddress.slice(0, 8) + "..."}`);
      setAmount("");
      onSuccess();
    } catch (e: any) {
      setError(e?.message || "Withdrawal failed");
    }
    setLoading(false);
  };

  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="text-sm font-medium text-slate-300">Withdraw</div>
      <p className="text-xs text-slate-500">
        Send USDC to your {chain === "near" ? "NEAR" : "Solana"} wallet: <span className="text-slate-400 font-mono">{chain === "near" ? nearAccountId : solanaAddress.slice(0, 12) + "..."}</span>
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
          <input
            type="number"
            min="1"
            step="0.01"
            placeholder="1.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 pl-7 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-white/[0.2]"
          />
        </div>
        <button
          onClick={handleWithdraw}
          disabled={loading || !amount || parseFloat(amount) < 1}
          className="px-4 py-2 text-sm font-medium bg-white/[0.06] text-slate-300 border border-white/[0.08] rounded-lg hover:bg-white/[0.1] disabled:opacity-30 transition-all"
        >
          {loading ? "..." : "Withdraw"}
        </button>
      </div>
      {error && <div className="text-red-400 text-xs">{error}</div>}
      {success && <div className="text-green-400 text-xs">{success}</div>}
    </div>
  );
}

/** Show legacy NEAR virtual balance if > 0, with withdraw prompt */
function LegacyNearBalance({ accountId }: { accountId: string }) {
  const [nearBalance, setNearBalance] = useState<string | null>(null);
  const { callFunction, viewMethod } = useNearWallet();
  const [withdrawing, setWithdrawing] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- viewMethod identity may change each render
  useEffect(() => {
    // Check virtual balance on NEAR contract
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.near";
    viewMethod({
      contractId,
      method: "get_balance",
      args: { account_id: accountId },
    }).then((raw: any) => {
      const yocto = String(raw ?? "0");
      if (yocto === "0") return;
      const near = Number(yocto) / 1e24;
      if (near >= 0.001) {
        setNearBalance(near.toFixed(4));
      }
    }).catch(() => {});
  }, [accountId]); // only re-run when accountId changes

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
            await callFunction({
              contractId,
              method: "withdraw",
              args: { amount: yocto },
              gas: "30000000000000",
              deposit: "0",
            });
            setNearBalance(null);
          } catch (e) {
            console.error("Withdraw failed:", e);
          }
          setWithdrawing(false);
        }}
        className="px-4 py-2 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-all"
      >
        {withdrawing ? "Withdrawing..." : "Withdraw to wallet"}
      </button>
    </div>
  );
}
