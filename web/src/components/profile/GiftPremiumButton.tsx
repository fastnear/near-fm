"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { buyPremiumFromBalance } from "@/lib/api";

export function GiftPremiumButton({ recipientSlug }: { recipientSlug: string }) {
  const { isAuthenticated, promptSignIn } = useAuth();
  const { showToast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [months, setMonths] = useState(1);
  const [buying, setBuying] = useState(false);

  const handleGift = async () => {
    if (!isAuthenticated) { promptSignIn(); return; }
    setBuying(true);
    try {
      const res = await buyPremiumFromBalance(months, recipientSlug);
      showToast({
        message: `Premium gifted! +${res.days_added} days for ${recipientSlug}`,
        type: "success",
        id: "gift-premium",
        duration: 5000,
      });
      setShowModal(false);
    } catch (e: any) {
      const msg = e?.message || "Gift failed";
      showToast({
        message: msg.includes("balance") ? "Insufficient balance. Top up at /balance" : msg,
        type: "error",
        id: "gift-premium",
        duration: 5000,
      });
    }
    setBuying(false);
  };

  return (
    <>
      <button
        onClick={() => isAuthenticated ? setShowModal(true) : promptSignIn()}
        className="px-4 py-2 text-sm text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 hover:border-cyan-500/30 rounded-xl transition-all diamond-shimmer"
      >
        ✦ Gift Premium
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-white/[0.1] shadow-2xl p-6 bg-slate-900/95 backdrop-blur-xl space-y-4">
            <h3 className="text-lg font-semibold text-white">Gift Premium to {recipientSlug}</h3>

            <div className="flex gap-2">
              {[1, 3, 12].map((m) => (
                <button
                  key={m}
                  onClick={() => setMonths(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                    months === m
                      ? "bg-purple-500/15 text-purple-300 border-purple-500/25"
                      : "bg-white/[0.04] text-slate-400 border-white/[0.06] hover:bg-white/[0.08]"
                  }`}
                >
                  {m} mo
                  <span className="block text-xs text-slate-500">${m * 10}</span>
                </button>
              ))}
            </div>

            <button
              onClick={handleGift}
              disabled={buying}
              className="w-full py-3 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40 transition-all"
            >
              {buying ? "Sending gift..." : `Gift ${months} ${months === 1 ? "month" : "months"} — $${months * 10}`}
            </button>

            <button onClick={() => setShowModal(false)} className="w-full text-center text-xs text-slate-500 hover:text-slate-400 py-1">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
