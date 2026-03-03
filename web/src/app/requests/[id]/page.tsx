"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { SongRequest } from "@/types";
import { getRequest, getRequestSubmissions, updateRequest } from "@/lib/api";
import { awardBountyAction, withdrawBountyAction } from "@/lib/near/contract";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";

function formatNear(yocto: string): string {
  const near = Number(yocto) / 1e24;
  const formatted = near.toFixed(2);
  return formatted.replace(/\.00$/, "");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const isOpen = status === "open";
  return (
    <span
      className={`inline-block px-3 py-1 text-sm font-medium rounded-full ${
        isOpen
          ? "bg-[#00ec97]/10 text-[#00ec97] border border-[#00ec97]/20"
          : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
      }`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function RequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { accountId, callFunction } = useNearWallet();

  const [request, setRequest] = useState<SongRequest | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [awarding, setAwarding] = useState<number | null>(null);
  const [error, setError] = useState("");

  const uuid = params.id as string;

  const refreshData = async () => {
    try {
      const [reqData, subs] = await Promise.all([
        getRequest(uuid),
        getRequestSubmissions(uuid),
      ]);
      setRequest((reqData as any).request ?? reqData as any);
      setSubmissions(subs);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refreshData().finally(() => setLoading(false));
  }, [uuid]);

  const handleWithdraw = async () => {
    if (!request) return;

    const confirmed = window.confirm(
      "Are you sure you want to withdraw the bounty? A penalty may apply."
    );
    if (!confirmed) return;

    setWithdrawing(true);
    setError("");

    try {
      const action = withdrawBountyAction(request.uuid);
      await callFunction({
        contractId: action.contractId,
        method: action.method,
        args: action.args as Record<string, unknown>,
        gas: action.gas,
      });

      await refreshData();
    } catch (e: any) {
      if (e.name === "WalletConnectionRequired") { setWithdrawing(false); return; }
      console.error("Failed to withdraw bounty:", e);
      setError(e instanceof Error ? e.message : "Failed to withdraw bounty");
    }
    setWithdrawing(false);
  };

  const handleAward = async (submission: any) => {
    if (!request) return;

    const confirmed = window.confirm(
      `Award the bounty of ${formatNear(request.bounty_amount_yocto)} NEAR to "${submission.song_title}" by ${submission.submitter_account_id}?`
    );
    if (!confirmed) return;

    setAwarding(submission.id);
    setError("");

    try {
      const action = awardBountyAction(request.uuid, submission.submitter_account_id);
      await callFunction({
        contractId: action.contractId,
        method: action.method,
        args: action.args as Record<string, unknown>,
        gas: action.gas,
      });

      // Update request status on backend
      await updateRequest(uuid, {
        status: "awarded",
        awarded_song_id: submission.song_id,
      });

      await refreshData();
    } catch (e: any) {
      if (e.name === "WalletConnectionRequired") { setAwarding(null); return; }
      console.error("Failed to award bounty:", e);
      setError(e instanceof Error ? e.message : "Failed to award bounty");
    }
    setAwarding(null);
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="animate-pulse space-y-6">
          <div className="h-8 skeleton rounded w-2/3" />
          <div className="h-6 skeleton rounded w-1/4" />
          <div className="h-32 skeleton rounded" />
          <div className="h-4 skeleton rounded w-1/3" />
        </div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <p className="text-slate-500 text-lg">Request not found</p>
        <Link
          href="/requests"
          className="text-purple-400 hover:text-purple-300 text-sm mt-4 inline-block transition"
        >
          Back to requests
        </Link>
      </div>
    );
  }

  const isRequester = user !== null && (request as any).requester_account_id === user?.slug;
  const isOpen = request.status === "open";
  const isExpired = request.expires_at ? new Date(request.expires_at) <= new Date() : false;
  const canWithdraw = isRequester && isOpen && isExpired;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* Back link */}
      <Link
        href="/requests"
        className="text-slate-500 hover:text-slate-300 text-sm mb-6 inline-flex items-center gap-1 transition"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to requests
      </Link>

      {/* Main card */}
      <div className="glass-card rounded-2xl p-8 mt-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold mb-2">{request.title}</h1>
            <StatusBadge status={request.status} />
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-2xl font-bold text-purple-400">
              {formatNear(request.bounty_amount_yocto)} NEAR
            </div>
            <div className="text-xs text-slate-500">bounty</div>
          </div>
        </div>

        {/* Description */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-400 mb-2">
            Description
          </h2>
          <p className="text-slate-300 whitespace-pre-wrap">
            {request.description}
          </p>
        </div>

        {/* Meta info */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500 mb-6 border-t border-white/[0.06] pt-6">
          {(request as any).requester_account_id && (
            <div>
              <span className="text-slate-600">Requester:</span>{" "}
              <Link
                href={`/profile/${(request as any).requester_account_id}`}
                className="text-purple-400 hover:text-purple-300 transition"
              >
                {(request as any).requester_account_id}
              </Link>
            </div>
          )}
          <div>
            <span className="text-slate-600">Created:</span>{" "}
            {formatDate(request.created_at)}
          </div>
          {request.bounty_tx_hash && (
            <div>
              <span className="text-slate-600">Bounty TX:</span>{" "}
              <a
                href={`https://nearblocks.io/txns/${request.bounty_tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 transition"
              >
                {request.bounty_tx_hash.slice(0, 8)}...
              </a>
            </div>
          )}
          {request.awarded_song_id && (
            <div>
              <span className="text-slate-600">Awarded Song ID:</span>{" "}
              {request.awarded_song_id}
            </div>
          )}
        </div>

        {/* Submissions */}
        {submissions.length > 0 && (
          <div className="mb-6 border-t border-white/[0.06] pt-6">
            <h2 className="text-sm font-medium text-slate-400 mb-3">
              Submissions ({submissions.length})
            </h2>
            <div className="space-y-2">
              {submissions.map((sub: any) => (
                <div
                  key={sub.id}
                  className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Mini cover */}
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/[0.04] flex-shrink-0">
                      {sub.song_cover_image_url ? (
                        <img
                          src={sub.song_cover_image_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600 text-lg">
                          &#9835;
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/song/${sub.song_uuid}`}
                        className="text-sm font-medium text-slate-200 hover:text-purple-400 transition truncate block"
                      >
                        {sub.song_title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        by{" "}
                        <Link
                          href={`/profile/${sub.submitter_account_id}`}
                          className="text-purple-400 hover:text-purple-300 transition"
                        >
                          {sub.submitter_account_id}
                        </Link>
                        {" "}&middot; {formatDate(sub.created_at)}
                      </p>
                    </div>
                  </div>

                  {/* Award button (requester only, open status) */}
                  {isRequester && isOpen && (
                    <button
                      onClick={() => handleAward(sub)}
                      disabled={awarding === sub.id}
                      className="px-4 py-1.5 text-xs font-medium bg-[#00ec97]/10 hover:bg-[#00ec97]/20 text-[#00ec97] disabled:opacity-30 rounded-lg border border-[#00ec97]/20 transition flex-shrink-0"
                    >
                      {awarding === sub.id ? "Awarding..." : "Award Bounty"}
                    </button>
                  )}

                  {/* Show winner badge if this song was awarded */}
                  {request.awarded_song_id === sub.song_id && (
                    <span className="px-3 py-1 text-xs font-medium bg-purple-500/10 text-purple-400 rounded-full border border-purple-500/20 flex-shrink-0">
                      Winner
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {isOpen && (
          <div className="border-t border-white/[0.06] pt-6 space-y-4">
            {/* Submit a song */}
            <div className="glass rounded-xl p-5">
              <h3 className="text-base font-semibold mb-2">
                Fulfill this request
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                Create an AI-generated song matching this request to earn the
                bounty of{" "}
                <span className="text-purple-400 font-medium">
                  {formatNear(request.bounty_amount_yocto)} NEAR
                </span>
                .
              </p>
              <Link
                href={`/upload?fulfills_request_id=${request.id}&request_uuid=${request.uuid}`}
                className="inline-flex items-center px-5 py-2.5 btn-primary rounded-xl text-sm font-medium transition"
              >
                Submit a Song
              </Link>
            </div>

            {/* Withdraw (requester only, after expiry) */}
            {isRequester && (
              <div className="bg-rose-500/[0.03] rounded-xl p-5 border border-rose-500/10">
                <h3 className="text-base font-semibold mb-2">
                  Withdraw Bounty
                </h3>
                {canWithdraw ? (
                  <p className="text-slate-400 text-sm mb-4">
                    The request has expired. You can withdraw your bounty with a 20% penalty fee.
                    The refund will be added to your virtual balance.
                  </p>
                ) : (
                  <p className="text-slate-400 text-sm mb-4">
                    Withdrawal is available after the request expires
                    {request.expires_at ? ` on ${formatDate(request.expires_at)}` : ""}.
                    A 20% penalty fee applies.
                  </p>
                )}
                {error && (
                  <p className="text-red-400 text-sm mb-3">{error}</p>
                )}
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawing || !canWithdraw}
                  className="px-5 py-2.5 bg-rose-500 hover:bg-rose-400 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition"
                >
                  {withdrawing ? "Withdrawing..." : "Withdraw Bounty"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Awarded status */}
        {request.status === "awarded" && (
          <div className="border-t border-white/[0.06] pt-6">
            <div className="bg-purple-500/[0.05] rounded-xl p-5 border border-purple-500/10">
              <h3 className="text-base font-semibold text-purple-400 mb-2">
                Bounty Awarded
              </h3>
              <p className="text-slate-400 text-sm">
                This request has been fulfilled and the bounty has been awarded.
              </p>
              {request.award_tx_hash && (
                <a
                  href={`https://nearblocks.io/txns/${request.award_tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block transition"
                >
                  View award transaction
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
