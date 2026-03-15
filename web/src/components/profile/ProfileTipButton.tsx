"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useToast } from "@/components/ui/Toast";
import { recordProfileTip } from "@/lib/api";
import type { ProfileComment } from "@/lib/api";
import { tipProfileAction, tipProfileFromBalanceArgs, getBalance } from "@/lib/near/contract";

const TIP_AMOUNTS = ["0.1", "0.5", "1", "5"];

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

interface Props {
  accountId: string;           // profile slug
  nearAccountId: string | null; // recipient's NEAR account
  onTipSuccess: (comment: ProfileComment) => void;
}

export function ProfileTipButton({ accountId, nearAccountId, onTipSuccess }: Props) {
  const { isAuthenticated } = useAuth();
  const { accountId: walletId, linkWallet, connectWallet, callFunction, viewMethod } = useNearWallet();
  const { showToast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (walletId && showModal) {
      getBalance(
        (params) => viewMethod(params).then((r) => String(r ?? "0")),
        walletId
      ).then(setBalance).catch(() => setBalance(null));
    }
  }, [walletId, showModal, viewMethod]);

  const handleTip = async (amountNear: string) => {
    if (!walletId) { isAuthenticated ? linkWallet() : connectWallet(); return; }
    if (!nearAccountId) {
      showToast({ message: "This artist hasn't linked a NEAR wallet yet", type: "error", id: "ptip" });
      return;
    }

    setLoading(true);
    const toastId = showToast({ message: `Sending ${amountNear} NEAR...`, type: "loading", id: "ptip" });
    try {
      const amountYocto = nearToYocto(amountNear);
      let txHash: string;
      let fromBalance = false;

      if (balance && BigInt(balance) >= BigInt(amountYocto)) {
        fromBalance = true;
        const action = tipProfileFromBalanceArgs(nearAccountId, amountYocto);
        txHash = await callFunction({ contractId: action.contractId, method: action.method, args: action.args, gas: action.gas });
      } else {
        const action = tipProfileAction(nearAccountId, amountYocto);
        txHash = await callFunction({ contractId: action.contractId, method: action.method, args: action.args, gas: action.gas, deposit: action.deposit });
      }

      const comment = await recordProfileTip(accountId, {
        tx_hash: txHash,
        amount_yocto: amountYocto,
        from_balance: fromBalance,
        body: message.trim() || undefined,
      });

      showToast({
        id: toastId,
        message: `${amountNear} NEAR sent!`,
        type: "success",
        link: { url: `https://near.rocks/tx/${txHash}`, label: "View transaction" },
        duration: 8000,
      });

      onTipSuccess(comment);
      setBalance(null); // force re-fetch on next open
      setMessage("");
      setCustomAmount("");
      setShowModal(false);
    } catch (e) {
      console.error("Profile tip failed:", e);
      showToast({ id: toastId, message: "Tip failed. Please try again.", type: "error", duration: 5000 });
    }
    setLoading(false);
  };

  const balanceNear = balance ? yoctoToNear(balance) : "0";
  const hasBalance = balance && BigInt(balance) > 0;

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!walletId) { isAuthenticated ? linkWallet() : connectWallet(); return; }
          setShowModal(!showModal);
        }}
        className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/30 transition-all"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Tip
      </button>

      {showModal && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowModal(false)} />
          <div className="absolute bottom-full mb-2 right-0 rounded-2xl p-4 shadow-2xl z-50 w-72 bg-slate-900 border border-white/[0.1]">
            <p className="text-xs font-medium text-slate-400 mb-3">Send NEAR tip</p>

            {hasBalance && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">Balance</span>
                <span className="text-xs font-medium text-purple-400">{balanceNear} NEAR</span>
              </div>
            )}

            <div className="flex gap-1.5 flex-wrap mb-3">
              {TIP_AMOUNTS.map((amount) => {
                const canUseBalance = balance && BigInt(balance) >= BigInt(nearToYocto(amount));
                return (
                  <button
                    key={amount}
                    onClick={() => handleTip(amount)}
                    disabled={loading}
                    className={`flex-1 min-w-[44px] px-2 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:opacity-50 ${
                      canUseBalance
                        ? "bg-purple-500/10 text-purple-300 border-purple-500/20 hover:bg-purple-500/20"
                        : "bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-white/[0.08]"
                    }`}
                  >
                    {amount}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-1.5 mb-3">
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Custom"
                className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
              />
              <button
                onClick={() => {
                  const val = parseFloat(customAmount);
                  if (val >= 0.1) handleTip(customAmount);
                }}
                disabled={loading || !customAmount || parseFloat(customAmount) < 0.1}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a message (optional)"
              maxLength={500}
              rows={2}
              className="w-full px-3 py-2 text-xs rounded-lg border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none resize-none"
            />

            {hasBalance && (
              <p className="text-[10px] text-slate-600 text-center mt-2">
                Purple = from balance · gray = wallet deposit
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
