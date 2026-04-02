"use client";

import { useEffect, useState } from "react";
import { getProfileComments, createProfileComment, deleteProfileComment, recordProfileTip } from "@/lib/api";
import type { ProfileComment } from "@/lib/api";
import { tipProfileAction, tipProfileFromBalanceArgs, getBalance } from "@/lib/near/contract";
import { PostCard } from "@/components/post/PostCard";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useToast } from "@/components/ui/Toast";

function nearToYocto(near: string): string {
  const parts = near.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(24, "0").slice(0, 24);
  return BigInt(whole + frac).toString();
}

interface FanFeedTabProps {
  accountId: string;
  displayName: string | null;
  nearAccountId: string | null;
  isOwnProfile: boolean;
}

export function FanFeedTab({ accountId, displayName, nearAccountId, isOwnProfile }: FanFeedTabProps) {
  const { user: authUser } = useAuth();
  const { accountId: walletAccountId, callFunction, connectWallet, viewMethod } = useNearWallet();
  const { showToast } = useToast();
  const currentUser = authUser?.slug ?? null;

  const [comments, setComments] = useState<ProfileComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tipAmount, setTipAmount] = useState<string | null>(null);

  useEffect(() => {
    getProfileComments(accountId)
      .then(setComments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accountId]);

  const handleSubmit = async () => {
    if ((!commentBody.trim() && !tipAmount) || submitting) return;
    setSubmitting(true);
    try {
      if (tipAmount && nearAccountId) {
        if (!walletAccountId) { connectWallet(); setSubmitting(false); return; }
        const amountYocto = nearToYocto(tipAmount);
        const toastId = showToast({ message: `Sending ${tipAmount} NEAR...`, type: "loading", id: "pc-tip" });

        let fromBalance = false;
        let txHash: string;
        try {
          const bal = await getBalance(
            (params) => viewMethod(params).then((r) => String(r ?? "0")),
            walletAccountId
          );
          if (bal && BigInt(bal) >= BigInt(amountYocto)) {
            fromBalance = true;
            const action = tipProfileFromBalanceArgs(nearAccountId, amountYocto);
            txHash = await callFunction({ contractId: action.contractId, method: action.method, args: action.args, gas: action.gas });
          } else {
            const action = tipProfileAction(nearAccountId, amountYocto);
            txHash = await callFunction({ contractId: action.contractId, method: action.method, args: action.args, gas: action.gas, deposit: action.deposit });
          }
        } catch (e: any) {
          const msg = e?.message || "";
          if (msg.includes("User rejected") || msg.includes("User cancelled")) {
            showToast({ id: toastId, message: "Cancelled", type: "error", duration: 2000 });
          } else {
            showToast({ id: toastId, message: "Tip failed. Please try again.", type: "error", duration: 5000 });
          }
          setSubmitting(false);
          return;
        }

        const comment = await recordProfileTip(accountId, {
          tx_hash: txHash,
          amount_yocto: amountYocto,
          from_balance: fromBalance,
          body: commentBody.trim() || undefined,
        });
        setComments((prev) => [comment, ...prev]);
        setCommentBody("");
        setTipAmount(null);
        showToast({ id: toastId, message: `${tipAmount} NEAR sent!`, type: "success", duration: 4000 });
      } else {
        const comment = await createProfileComment(accountId, commentBody.trim());
        setComments((prev) => [comment, ...prev]);
        setCommentBody("");
        showToast({ message: "Comment posted!", type: "success", id: "pc-ok", duration: 2000 });
      }
    } catch (e) {
      console.error("Failed to post:", e);
      showToast({ message: "Failed to post. Please try again.", type: "error", id: "pc-err" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteProfileComment(accountId, id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      console.error("Failed to delete comment:", e);
      showToast({ message: "Failed to delete comment.", type: "error", id: "pc-del-err" });
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full skeleton" />
            <div className="flex-1 space-y-2">
              <div className="h-3 skeleton rounded w-32" />
              <div className="h-4 skeleton rounded w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Comment + optional tip form */}
      {currentUser && !isOwnProfile && (
        <div className="mb-5 space-y-2">
          <div className="flex gap-3">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
              placeholder={`Leave a message for ${displayName || accountId}...`}
              maxLength={1000}
              rows={2}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none resize-none"
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || (!commentBody.trim() && !tipAmount)}
              className="self-end px-4 py-2.5 btn-primary rounded-xl text-sm disabled:opacity-40"
            >
              {submitting ? "..." : tipAmount ? `Send ${tipAmount} NEAR` : "Post"}
            </button>
          </div>
          {nearAccountId && walletAccountId && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 mr-1">Tip:</span>
              {["0.1", "0.5", "1", "5"].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setTipAmount(tipAmount === amt ? null : amt)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                    tipAmount === amt
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-white/[0.04] text-slate-500 border-white/[0.06] hover:text-slate-300 hover:bg-white/[0.08]"
                  }`}
                >
                  {amt} Ⓝ
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {comments.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          {isOwnProfile ? "No messages yet." : "No messages yet. Be the first to leave one!"}
        </p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <PostCard
              key={c.id}
              id={c.id}
              body={c.body}
              created_at={c.created_at}
              author_account_id={c.author_account_id}
              author_display_name={c.author_display_name}
              author_avatar_url={c.author_avatar_url}
              author_is_premium={c.author_is_premium}
              author_is_agent={c.author_is_agent}
              amount_yocto={c.amount_yocto}
              reply_count={c.reply_count}
              parentType="profile_comment"
              profileSlug={accountId}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
