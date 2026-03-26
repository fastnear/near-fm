"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { SongRequest } from "@/types";
import { getRequest, getRequestSubmissions, updateRequest, getUserProfile, followUser, awardBountyFromBalance, withdrawBountyFromBalance, topupBountyFromBalance } from "@/lib/api";
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
  const [requesterBounties, setRequesterBounties] = useState<{ count: number; totalNear: string } | null>(null);
  const [isFollowingRequester, setIsFollowingRequester] = useState(false);

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

  useEffect(() => {
    if (!request || !(request as any).requester_account_id) return;
    getUserProfile((request as any).requester_account_id)
      .then((p: any) => {
        if (p.active_bounties_count > 0) {
          const near = (Number(p.active_bounties_total_yocto) / 1e24).toFixed(1).replace(/\.0$/, "");
          setRequesterBounties({ count: p.active_bounties_count, totalNear: near });
        }
      })
      .catch(() => {});
  }, [request]);

  const isUsdBounty = request?.bounty_payment_method === "balance";

  const [topupAmount, setTopupAmount] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);

  const handleWithdraw = async () => {
    if (!request) return;

    const confirmed = window.confirm(
      "Are you sure you want to withdraw the bounty? A 20% penalty applies."
    );
    if (!confirmed) return;

    setWithdrawing(true);
    setError("");

    try {
      if (isUsdBounty) {
        await withdrawBountyFromBalance(request.uuid);
      } else {
        const action = withdrawBountyAction(request.uuid);
        await callFunction({
          contractId: action.contractId,
          method: action.method,
          args: action.args as Record<string, unknown>,
          gas: action.gas,
        });
      }
      await refreshData();
    } catch (e: any) {
      if (e.name === "WalletConnectionRequired") { setWithdrawing(false); return; }
      setError(e instanceof Error ? e.message : "Failed to withdraw bounty");
    }
    setWithdrawing(false);
  };

  const handleAward = async (submission: any) => {
    if (!request) return;

    const bountyDisplay = isUsdBounty
      ? `$${((request.bounty_usd_cents || 0) / 100).toFixed(2)}`
      : `${formatNear(request.bounty_amount_yocto)} NEAR`;

    const confirmed = window.confirm(
      `Award the bounty of ${bountyDisplay} to "${submission.song_title}" by ${submission.submitter_account_id}?`
    );
    if (!confirmed) return;

    setAwarding(submission.id);
    setError("");

    try {
      if (isUsdBounty) {
        await awardBountyFromBalance(request.uuid, submission.song_id);
      } else {
        const recipientNearId = submission.submitter_near_account_id;
        if (!recipientNearId) {
          setError("This submitter hasn't linked a NEAR wallet. Cannot award bounty.");
          setAwarding(null);
          return;
        }
        const action = awardBountyAction(request.uuid, recipientNearId);
        await callFunction({
          contractId: action.contractId,
          method: action.method,
          args: action.args as Record<string, unknown>,
          gas: action.gas,
        });
        await updateRequest(uuid, { status: "awarded", awarded_song_id: submission.song_id });
      }
      await refreshData();
    } catch (e: any) {
      if (e.name === "WalletConnectionRequired") { setAwarding(null); return; }
      setError(e instanceof Error ? e.message : "Failed to award bounty");
    }
    setAwarding(null);
  };

  const handleTopup = async () => {
    if (!request) return;
    const usd = parseFloat(topupAmount);
    if (isNaN(usd) || usd < 0.10) { setError("Minimum top-up is $0.10"); return; }

    setTopupLoading(true);
    setError("");
    try {
      await topupBountyFromBalance(request.uuid, Math.round(usd * 100));
      setTopupAmount("");
      await refreshData();
    } catch (e: any) {
      setError(e?.message || "Top-up failed");
    }
    setTopupLoading(false);
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
              {isUsdBounty
                ? `$${((request.bounty_usd_cents || 0) / 100).toFixed(2)}`
                : `${formatNear(request.bounty_amount_yocto)} NEAR`}
            </div>
            <div className="text-xs text-slate-500">bounty{isUsdBounty ? " (USDC)" : ""}</div>
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
                href={`https://near.rocks/tx/${request.bounty_tx_hash}`}
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

        {/* Follow requester */}
        {user && !isFollowingRequester && requesterBounties && (request as any).requester_account_id && user.slug !== (request as any).requester_account_id && (
          <div className="mb-6 rounded-xl bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20 px-5 py-4">
            <p className="text-sm text-slate-200">
              <Link href={`/profile/${(request as any).requester_account_id}`} className="text-purple-400 hover:text-purple-300 font-medium">{(request as any).requester_account_id}</Link> has <span className="font-bold text-purple-400">{requesterBounties.count} active {requesterBounties.count === 1 ? "bounty" : "bounties"}</span> totaling <span className="font-bold text-cyan-400">{requesterBounties.totalNear} NEAR</span>.{" "}
              <button onClick={async () => { try { await followUser((request as any).requester_account_id); setIsFollowingRequester(true); } catch {} }} className="text-purple-400 hover:text-purple-300 underline underline-offset-2 font-medium transition">Follow</button> to get notified about new bounties!
            </p>
          </div>
        )}

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
                    sub.submitter_near_account_id ? (
                      <button
                        onClick={() => handleAward(sub)}
                        disabled={awarding === sub.id}
                        className="px-4 py-1.5 text-xs font-medium bg-[#00ec97]/10 hover:bg-[#00ec97]/20 text-[#00ec97] disabled:opacity-30 rounded-lg border border-[#00ec97]/20 transition flex-shrink-0"
                      >
                        {awarding === sub.id ? "Awarding..." : "Award Bounty"}
                      </button>
                    ) : (
                      <span className="px-3 py-1 text-xs text-slate-500 flex-shrink-0" title="This user hasn't linked a NEAR wallet">
                        No wallet
                      </span>
                    )
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
                  {isUsdBounty
                    ? `$${((request.bounty_usd_cents || 0) / 100).toFixed(2)}`
                    : `${formatNear(request.bounty_amount_yocto)} NEAR`}
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

            {/* Top up bounty (anyone, USD bounties only) */}
            {isUsdBounty && (
              <div className="glass rounded-xl p-5">
                <h3 className="text-base font-semibold mb-2">Add to Bounty</h3>
                <p className="text-slate-400 text-sm mb-3">Anyone can add funds to increase the bounty.</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input
                      type="number"
                      min="0.10"
                      step="0.01"
                      placeholder="1.00"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 pl-7 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <button
                    onClick={handleTopup}
                    disabled={topupLoading || !topupAmount || parseFloat(topupAmount) < 0.10}
                    className="px-4 py-2 text-sm font-medium btn-primary rounded-lg disabled:opacity-30"
                  >
                    {topupLoading ? "..." : "Add"}
                  </button>
                </div>
              </div>
            )}

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
                  href={`https://near.rocks/tx/${request.award_tx_hash}`}
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
