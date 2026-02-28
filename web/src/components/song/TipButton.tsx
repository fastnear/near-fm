"use client";

import { useState, useEffect } from "react";
import type { Song } from "@/types";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { recordTip } from "@/lib/api";
import { tipSongAction, tipFromBalanceArgs, getBalance } from "@/lib/near/contract";

const TIP_AMOUNTS = ["0.01", "0.1", "0.5", "1", "5"];

function nearToYocto(near: string): string {
  const parts = near.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(24, "0").slice(0, 24);
  return BigInt(whole + frac).toString();
}

function yoctoToNear(yocto: string): string {
  if (!yocto || yocto === "0") return "0";
  const padded = yocto.padStart(25, "0");
  const whole = padded.slice(0, padded.length - 24) || "0";
  const frac = padded.slice(padded.length - 24, padded.length - 20);
  return `${whole}.${frac}`;
}

export function TipButton({ song, compact }: { song: Song; compact?: boolean }) {
  const { accountId, isAuthenticated, signIn, completeSignIn, callFunction, viewMethod } = useNearWallet();
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    if (accountId && showModal) {
      getBalance(
        (params) => viewMethod(params).then((r) => String(r ?? "0")),
        accountId
      )
        .then((b) => setBalance(b))
        .catch(() => setBalance(null));
    }
  }, [accountId, showModal, viewMethod]);

  const handleTip = async (amountNear: string) => {
    if (!isAuthenticated) {
      if (accountId) { completeSignIn(); } else { signIn(); }
      return;
    }

    setLoading(true);
    try {
      const amountYocto = nearToYocto(amountNear);
      let txHash: string;
      let fromBalance = false;

      // If user has enough virtual balance, tip from balance (no wallet popup)
      if (balance && BigInt(balance) >= BigInt(amountYocto)) {
        fromBalance = true;
        const action = tipFromBalanceArgs(
          song.uploader_account_id,
          amountYocto,
          song.uuid
        );
        txHash = await callFunction({
          contractId: action.contractId,
          method: action.method,
          args: action.args,
          gas: action.gas,
        });
      } else {
        // Not enough balance — send full amount as deposit (goes to virtual balance)
        const action = tipSongAction(
          song.uploader_account_id,
          song.uuid,
          amountYocto
        );
        txHash = await callFunction({
          contractId: action.contractId,
          method: action.method,
          args: action.args,
          gas: action.gas,
          deposit: action.deposit,
        });
      }

      await recordTip({
        song_uuid: song.uuid,
        tx_hash: txHash,
        amount_yocto: amountYocto,
        from_balance: fromBalance,
      });

      // Refresh balance
      if (accountId) {
        getBalance(
          (params) => viewMethod(params).then((r) => String(r ?? "0")),
          accountId
        ).then((b) => setBalance(b)).catch(() => {});
      }

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setShowModal(false);
      }, 2000);
    } catch (e) {
      console.error("Tip failed:", e);
    }
    setLoading(false);
  };

  const hasBalance =
    balance && BigInt(balance) > 0;
  const balanceNear = balance ? yoctoToNear(balance) : "0";

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!isAuthenticated) {
            if (accountId) { completeSignIn(); } else { signIn(); }
            return;
          }
          setShowModal(!showModal);
        }}
        className={compact
          ? "p-1.5 rounded-lg text-amber-400 hover:bg-amber-500/15 transition-all"
          : "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/30 transition-all"
        }
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {!compact && "Tip"}
      </button>

      {showModal && (
        <div className="absolute bottom-full mb-2 left-0 rounded-2xl p-4 shadow-2xl z-50 min-w-[240px] bg-slate-900 border border-white/[0.1]">
          {success ? (
            <div className="flex items-center gap-2 text-[#00ec97] text-sm">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Tip sent!
            </div>
          ) : (
            <div className="space-y-3">
              {hasBalance && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Balance</span>
                  <span className="text-xs font-medium text-purple-400">{balanceNear} NEAR</span>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap">
                {TIP_AMOUNTS.map((amount) => {
                  const canUseBalance = balance && BigInt(balance) >= BigInt(nearToYocto(amount));
                  return (
                    <button
                      key={amount}
                      onClick={() => handleTip(amount)}
                      disabled={loading}
                      className={`flex-1 min-w-[36px] px-1.5 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-50 ${
                        canUseBalance
                          ? "bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/20"
                          : "bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15]"
                      }`}
                    >
                      {amount}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="Custom"
                  className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
                />
                <button
                  onClick={() => {
                    const val = parseFloat(customAmount);
                    if (val >= 0.01) handleTip(customAmount);
                  }}
                  disabled={loading || !customAmount || parseFloat(customAmount) < 0.01}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Tip
                </button>
              </div>
              {hasBalance && (
                <p className="text-[10px] text-slate-500 text-center">
                  Purple = from balance, gray = wallet deposit
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
