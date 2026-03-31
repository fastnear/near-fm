"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useSolanaWallet } from "@/contexts/SolanaWalletContext";
import { getWalletBalance, withdrawFromBalance } from "@/lib/api";
import { getIntentsBalance } from "@/lib/outlayer";
import { DepositForm } from "@/components/balance/DepositForm";

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

const INTERNAL_TOKENS = [
  { symbol: "wNEAR", contract: "wrap.near", decimals: 24, defuseId: "nep141:wrap.near" },
  { symbol: "USDT", contract: "usdt.tether-token.near", decimals: 6, defuseId: "nep141:usdt.tether-token.near" },
] as const;

export default function BalancePageWrapper() {
  return <Suspense><BalancePage /></Suspense>;
}

function BalancePage() {
  const { user, isAuthenticated, loading: authLoading, promptSignIn } = useAuth();
  const { accountId } = useNearWallet();
  const { solanaAddress } = useSolanaWallet();

  const [balanceFormatted, setBalanceFormatted] = useState("0.00");
  const [balanceRaw, setBalanceRaw] = useState("0");

  const hasSolana = !!solanaAddress || !!user?.solana_address;
  const hasNear = !!accountId;

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
          <p className="text-slate-400">Your USDC balance for tips, credits, and bounties.</p>
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

        {/* Deposit */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="text-sm font-medium text-slate-300">Add Funds</div>
          {!isAuthenticated ? (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">Sign in to manage your balance</p>
              <button onClick={promptSignIn} className="btn-primary px-6 py-2 rounded-xl text-sm">Sign In</button>
            </div>
          ) : (
            <DepositForm onDeposited={fetchBalance} />
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
            ethAddress={user?.eth_address || ""}
            balanceRaw={balanceRaw}
            onSuccess={fetchBalance}
          />
        )}

        {/* What you can spend on */}
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

        {/* Internal balances link */}
        {isAuthenticated && (
          <InternalBalances user={user} />
        )}

        <div className="text-center">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">Back to home</Link>
        </div>
      </div>
    </div>
  );
}

/** Withdraw USDC to wallet on any chain */
function WithdrawSection({ hasNear, hasSolana, nearAccountId, solanaAddress, ethAddress, balanceRaw, onSuccess }: {
  hasNear: boolean; hasSolana: boolean; nearAccountId: string; solanaAddress: string; ethAddress: string; balanceRaw: string; onSuccess: () => void;
}) {
  const defaultChain = hasNear ? "near" : hasSolana ? "solana" : ethAddress ? "ethereum" : "ethereum";
  const defaultAddr = hasNear ? nearAccountId : hasSolana ? solanaAddress : ethAddress;
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
    else if (ethAddress && ["ethereum", "base", "arbitrum", "bsc", "polygon", "optimism", "avalanche"].includes(newChain)) setReceiver(ethAddress);
    else setReceiver("");
  };

  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="text-sm font-medium text-slate-300">Withdraw</div>
      <div>
        <label className="text-xs text-slate-500 mb-1 block">Chain</label>
        <select value={chain} onChange={(e) => handleChainChange(e.target.value)} disabled={loading}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-white/[0.2] appearance-none cursor-pointer"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundRepeat: "no-repeat", backgroundSize: "1.5em 1.5em", paddingRight: "2.5rem" }}
        >
          {WITHDRAW_CHAINS.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <div className="text-[11px] text-slate-500 mt-1">
          {chain === "near" ? "Withdraws to NEAR Intents balance of the recipient"
            : chain === "solana" ? ""
            : "Same 0x address works on all EVM chains"}
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-500 mb-1 block">{chainMeta.name} address</label>
        <input type="text" value={receiver} onChange={(e) => setReceiver(e.target.value)}
          placeholder={chainMeta.placeholder} disabled={loading}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 px-3 text-sm text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-white/[0.2]" />
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
          <input type="number" min="0.01" step="0.01" placeholder="1.00" value={amount}
            onChange={(e) => { setAmount(e.target.value); setIsMax(false); }} disabled={loading}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 pl-7 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-white/[0.2]" />
        </div>
        <button onClick={handleMax} disabled={loading}
          className="px-3 py-2 text-xs font-medium text-slate-400 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] transition-all">Max</button>
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

/** Internal balances — shows non-USDC tokens stuck on intents after failed swaps */
function InternalBalances({ user }: { user: any }) {
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState<{ symbol: string; raw: string; formatted: string; contract: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBalances = async () => {
    const apiKey = localStorage.getItem("nearfm_outlayer_api_key");
    if (!apiKey) return;
    setLoading(true);
    const results: typeof balances = [];
    for (const token of INTERNAL_TOKENS) {
      try {
        const resp = await getIntentsBalance(apiKey, token.contract);
        const raw = resp.balance || "0";
        if (raw !== "0") {
          const val = BigInt(raw);
          const whole = val / BigInt(10 ** token.decimals);
          const frac = val % BigInt(10 ** token.decimals);
          const fracStr = frac.toString().padStart(token.decimals, "0").replace(/0+$/, "");
          results.push({
            symbol: token.symbol,
            raw,
            formatted: fracStr ? `${whole}.${fracStr}` : `${whole}`,
            contract: token.contract,
          });
        }
      } catch {}
    }
    setBalances(results);
    setLoading(false);
  };

  return (
    <div className="text-center">
      <button onClick={() => { setOpen(!open); if (!open) fetchBalances(); }}
        className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
        {open ? "Hide internal balances" : "View internal balances"}
      </button>
      {open && (
        <div className="glass-card rounded-2xl p-4 mt-2 text-left">
          {loading ? (
            <div className="text-xs text-slate-500 text-center">Loading...</div>
          ) : balances.length === 0 ? (
            <div className="text-xs text-slate-500 text-center">No pending tokens</div>
          ) : (
            <div className="space-y-2">
              {balances.map((b) => (
                <div key={b.symbol} className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">{b.formatted} {b.symbol}</span>
                  <WithdrawTokenButton symbol={b.symbol} raw={b.raw} contract={b.contract} user={user} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WithdrawTokenButton({ symbol, raw, contract, user }: { symbol: string; raw: string; contract: string; user: any }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const receiver = user?.near_account_id || user?.solana_address || user?.eth_address || "";
  const chain = user?.near_account_id ? "near" : user?.solana_address ? "solana" : "ethereum";

  if (!receiver) return null;

  return (
    <button disabled={loading || done} onClick={async () => {
      setLoading(true);
      try {
        const apiKey = localStorage.getItem("nearfm_outlayer_api_key");
        if (!apiKey) throw new Error("No wallet");
        const tokenWithPrefix = `nep141:${contract}`;
        const res = await fetch("https://api.outlayer.fastnear.com/wallet/v1/intents/withdraw", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ token: tokenWithPrefix, amount: raw, chain, to: receiver }),
        });
        if (!res.ok) throw new Error(await res.text());
        setDone(true);
      } catch (e: any) {
        alert(`Withdraw failed: ${e?.message || "Unknown error"}`);
      }
      setLoading(false);
    }} className="px-3 py-1 text-xs font-medium text-slate-400 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] disabled:opacity-30 transition-all">
      {done ? "Sent" : loading ? "..." : "Withdraw"}
    </button>
  );
}

/** Show legacy NEAR virtual balance if > 0 */
function LegacyNearBalance({ accountId }: { accountId: string }) {
  const [nearBalance, setNearBalance] = useState<string | null>(null);
  const { callFunction, viewMethod } = useNearWallet();
  const [withdrawing, setWithdrawing] = useState(false);

  useEffect(() => {
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.near";
    viewMethod({ contractId, method: "get_balance", args: { account_id: accountId } })
      .then((raw: any) => {
        const yocto = String(raw ?? "0");
        if (yocto === "0") return;
        const near = Number(yocto) / 1e24;
        if (near >= 0.001) setNearBalance(near.toFixed(4));
      }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      </p>
      <button disabled={withdrawing} onClick={async () => {
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
      >{withdrawing ? "Withdrawing..." : "Withdraw to wallet"}</button>
    </div>
  );
}
