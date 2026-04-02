"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Song } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { voteSong, getUserVote, diamondLikeSong, getDiamondLikers, getDiamondLikesRemaining } from "@/lib/api";

interface Props {
  song: Song;
  compact?: boolean;
}

function ThumbUp({ filled, className }: { filled: boolean; className?: string }) {
  return filled ? (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.493 18.5c-.425 0-.82-.236-.975-.632A7.48 7.48 0 0 1 6 15.125c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V3a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23h-.777ZM2.331 10.727a11.969 11.969 0 0 0-.831 4.398 12 12 0 0 0 .52 3.507c.26.85 1.084 1.368 1.973 1.368H4.9c.445 0 .72-.498.523-.898a8.963 8.963 0 0 1-.924-3.977c0-1.708.476-3.305 1.302-4.666.245-.403-.028-.959-.5-.959H4.25c-.832 0-1.612.453-1.918 1.227Z" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H3.5" />
    </svg>
  );
}

function ThumbDown({ filled, className }: { filled: boolean; className?: string }) {
  return filled ? (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.73 5.5h1.035A7.984 7.984 0 0 1 18 9.625c0 1.75-.599 3.358-1.602 4.634-.151.192-.373.309-.6.397-.473.183-.89.514-1.212.924a9.042 9.042 0 0 1-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 0 0-.322 1.672V21.75a.75.75 0 0 1-.75.75 2.25 2.25 0 0 1-2.25-2.25c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H3.622c-1.026 0-1.945-.694-2.054-1.715A12.137 12.137 0 0 1 1.5 12.25c0-2.848.992-5.464 2.649-7.521C4.537 4.247 5.136 4 5.754 4H8.77c.483 0 .964.078 1.423.23l3.114 1.04a4.501 4.501 0 0 0 1.423.23ZM21.669 14.023c.536-1.362.831-2.845.831-4.398 0-1.22-.182-2.398-.52-3.507-.26-.85-1.084-1.368-1.973-1.368H19.1c-.445 0-.72.498-.523.898.591 1.2.924 2.55.924 3.977a8.959 8.959 0 0 1-1.302 4.666c-.245.403.028.959.5.959h1.053c.832 0 1.612-.453 1.918-1.227Z" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 0 1-.068-1.285c0-2.848.992-5.464 2.649-7.521C5.287 4.247 5.886 4 6.504 4h4.016a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 1.02.845.623 1.282a9.014 9.014 0 0 0-1.68 3.218 2.25 2.25 0 0 0 2.809 2.75c.681-.17 1.073-.89.89-1.571a5.972 5.972 0 0 1 2.86-6.429l.09-.052M7.498 15.25h13.252" />
    </svg>
  );
}

function PortalTooltip({
  anchorRef,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.top + window.scrollY,
      left: rect.left + rect.width / 2 + window.scrollX,
    });
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      style={{ position: "absolute", top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }}
      className="z-[9999] pointer-events-auto"
    >
      <div className="mb-2">{children}</div>
    </div>,
    document.body
  );
}

function DiamondTooltipContent({
  songUuid,
  diamondLikeCount,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  songUuid: string;
  diamondLikeCount: number;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [likers, setLikers] = useState<{ account_id: string; display_name: string | null }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded && diamondLikeCount > 0) {
      setLoaded(true);
      getDiamondLikers(songUuid).then(setLikers).catch(() => {});
    }
  }, [loaded, songUuid, diamondLikeCount]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="px-3 py-2 rounded-lg bg-slate-900/95 border border-white/10 text-xs text-slate-300 whitespace-nowrap shadow-xl cursor-pointer hover:border-cyan-400/30 transition-colors"
    >
      <div className="font-medium mb-1 diamond-shimmer">Diamond likes</div>
      {likers.length > 0 && (
        <div className="space-y-0.5">
          {likers.map((l) => (
            <Link
              key={l.account_id}
              href={`/profile/${l.account_id}`}
              className="block text-cyan-300 hover:text-cyan-200 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              ✦ {l.display_name || l.account_id}
            </Link>
          ))}
        </div>
      )}
      <div className="text-[10px] text-slate-500 mt-1 border-t border-white/10 pt-1">
        Learn about Premium →
      </div>
    </div>
  );
}

export function VoteButtons({ song, compact }: Props) {
  const router = useRouter();
  const { isAuthenticated, isPremium, promptSignIn } = useAuth();
  const [upvotes, setUpvotes] = useState(song.upvotes);
  const [downvotes, setDownvotes] = useState(song.downvotes);
  const [userVote, setUserVote] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [diamondLikeCount, setDiamondLikeCount] = useState(song.diamond_like_count || 0);
  const [userHasDiamondLiked, setUserHasDiamondLiked] = useState(false);
  const [diamondLoading, setDiamondLoading] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [diamondQuotaExhausted, setDiamondQuotaExhausted] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const didHold = useRef(false);
  const diamondAnchorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isAuthenticated && song.uuid) {
      getUserVote(song.uuid)
        .then((r) => {
          setUserVote(r.user_vote);
          setUpvotes(r.upvotes);
          setDownvotes(r.downvotes);
          setDiamondLikeCount(r.diamond_like_count);
          setUserHasDiamondLiked(r.user_has_diamond_liked);
        })
        .catch(() => {});
      if (isPremium && !compact) {
        getDiamondLikesRemaining()
          .then((r) => setDiamondQuotaExhausted(r.diamond_likes_remaining_today <= 0))
          .catch(() => {});
      }
    }
  }, [isAuthenticated, isPremium, compact, song.uuid]);

  const handleVote = useCallback(async (value: 1 | -1) => {
    if (!isAuthenticated) { promptSignIn(); return; }
    if (loading) return;
    setLoading(true);
    try {
      const sendValue = userVote === value ? 0 : value;
      const result = await voteSong(song.uuid, sendValue as 1 | -1 | 0);
      setUpvotes(result.upvotes);
      setDownvotes(result.downvotes);
      setUserVote(result.user_vote);
      setDiamondLikeCount(result.diamond_like_count);
      setUserHasDiamondLiked(result.user_has_diamond_liked);
    } catch (e) {
      console.error("Vote failed:", e);
    }
    setLoading(false);
  }, [isAuthenticated, loading, userVote, song.uuid, promptSignIn]);

  const handleDiamondLike = useCallback(async () => {
    if (!isAuthenticated) { promptSignIn(); return; }
    if (!isPremium) { router.push("/premium"); return; }
    if (diamondLoading) return;
    setDiamondLoading(true);
    // Optimistic: if adding diamond and user had regular upvote, subtract it immediately
    const hadUpvote = userVote === 1;
    const willAddDiamond = !userHasDiamondLiked;
    if (willAddDiamond && hadUpvote) {
      setUpvotes((v) => v - 1);
      setUserVote(0);
    }
    try {
      const result = await diamondLikeSong(song.uuid);
      setDiamondLikeCount(result.diamond_like_count);
      setUserHasDiamondLiked(result.user_has_diamond_liked);
      // Sync actual counts from server
      getUserVote(song.uuid).then((r) => {
        setUpvotes(r.upvotes);
        setDownvotes(r.downvotes);
        setUserVote(r.user_vote);
        setDiamondLikeCount(r.diamond_like_count);
        setUserHasDiamondLiked(r.user_has_diamond_liked);
      }).catch(() => {});
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("limit reached")) {
        setDiamondQuotaExhausted(true);
      }
      // Revert optimistic update on error
      if (willAddDiamond && hadUpvote) {
        setUpvotes((v) => v + 1);
        setUserVote(1);
      }
    }
    setDiamondLoading(false);
  }, [isAuthenticated, isPremium, diamondLoading, song.uuid, promptSignIn, router, userVote, userHasDiamondLiked]);

  const handleTooltipEnter = useCallback(() => {
    clearTimeout(tooltipTimeout.current);
    setShowTooltip(true);
  }, []);
  const handleTooltipLeave = useCallback(() => {
    tooltipTimeout.current = setTimeout(() => setShowTooltip(false), 200);
  }, []);

  const openPanel = useCallback(() => setShowPanel(true), []);
  const handlePanelEnter = useCallback(() => {
    clearTimeout(panelTimeout.current);
    clearTimeout(hoverTimer.current);
    setShowPanel(true);
  }, []);
  const handlePanelLeave = useCallback(() => {
    panelTimeout.current = setTimeout(() => setShowPanel(false), 300);
  }, []);

  // Full mode premium button: hold 0.3s OR hover 0.5s = open panel
  const handleBtnMouseDown = useCallback(() => {
    didHold.current = false;
    holdTimer.current = setTimeout(() => {
      didHold.current = true;
      openPanel();
    }, 300);
  }, [openPanel]);

  const handleBtnMouseUp = useCallback(() => {
    clearTimeout(holdTimer.current);
    if (!didHold.current) {
      handleDiamondLike();
    }
  }, [handleDiamondLike]);

  const handleBtnMouseEnter = useCallback(() => {
    clearTimeout(panelTimeout.current);
    hoverTimer.current = setTimeout(() => {
      openPanel();
    }, 500);
  }, [openPanel]);

  const handleBtnMouseLeave = useCallback(() => {
    clearTimeout(holdTimer.current);
    clearTimeout(hoverTimer.current);
    panelTimeout.current = setTimeout(() => setShowPanel(false), 300);
  }, []);

  const net = upvotes + diamondLikeCount - downvotes;
  const hasDiamondLikes = diamondLikeCount > 0;

  // Should we show diamond button? Only if premium AND (has quota OR already diamond-liked this song)
  const showDiamond = isPremium && (!diamondQuotaExhausted || userHasDiamondLiked);

  // ── Compact mode (SongCard) ──
  if (compact) {
    return (
      <div className="flex items-center">
        {showDiamond ? (
          // Premium user: diamond-styled button
          <>
            <button
              ref={diamondAnchorRef}
              onClick={handleDiamondLike}
              onMouseEnter={hasDiamondLikes ? handleTooltipEnter : undefined}
              onMouseLeave={hasDiamondLikes ? handleTooltipLeave : undefined}
              className={`p-1 rounded-lg transition-all duration-200 hover:scale-110 cursor-pointer ${
                userHasDiamondLiked
                  ? "diamond-shimmer-icon"
                  : userVote === 1
                    ? "text-[#00ec97]"
                    : "diamond-shimmer-icon opacity-50"
              }`}
              disabled={diamondLoading}
              title={userHasDiamondLiked ? "Remove Diamond Like" : "Diamond Like — boosts this track"}
            >
              <ThumbUp filled={userHasDiamondLiked || userVote === 1} className="w-[18px] h-[18px]" />
            </button>
            {showTooltip && hasDiamondLikes && (
              <PortalTooltip anchorRef={diamondAnchorRef}>
                <DiamondTooltipContent
                  songUuid={song.uuid}
                  diamondLikeCount={diamondLikeCount}
                  onClick={() => router.push("/premium")}
                  onMouseEnter={handleTooltipEnter}
                  onMouseLeave={handleTooltipLeave}
                />
              </PortalTooltip>
            )}
          </>
        ) : (
          // Non-premium user: green like button, no diamond styling
          <button
            ref={diamondAnchorRef}
            onClick={() => handleVote(1)}
            onMouseEnter={hasDiamondLikes ? handleTooltipEnter : undefined}
            onMouseLeave={hasDiamondLikes ? handleTooltipLeave : undefined}
            className={`p-1 rounded-lg transition-all duration-200 cursor-pointer ${
              userVote === 1
                ? "text-[#00ec97] bg-[#00ec97]/15"
                : "text-slate-500 hover:text-[#00ec97] hover:bg-[#00ec97]/10"
            }`}
            disabled={loading}
          >
            <ThumbUp filled={userVote === 1} className="w-[18px] h-[18px]" />
          </button>
        )}
        {/* Diamond tooltip for non-diamond users too (shows who diamond-liked) */}
        {!showDiamond && showTooltip && hasDiamondLikes && (
          <PortalTooltip anchorRef={diamondAnchorRef}>
            <DiamondTooltipContent
              songUuid={song.uuid}
              diamondLikeCount={diamondLikeCount}
              onClick={() => router.push("/premium")}
              onMouseEnter={handleTooltipEnter}
              onMouseLeave={handleTooltipLeave}
            />
          </PortalTooltip>
        )}

        {net !== 0 && <span
          className={`text-sm font-semibold min-w-[20px] text-center tabular-nums ${
            net > 0
              ? "text-[#00ec97]"
              : "text-rose-400"
          }`}
        >
          {net}
        </span>}

        <button
          onClick={() => handleVote(-1)}
          className={`p-1 rounded-lg transition-all duration-200 cursor-pointer ${
            userVote === -1
              ? "text-rose-400 bg-rose-400/15"
              : "text-slate-500 hover:text-rose-400 hover:bg-rose-400/10"
          }`}
          disabled={loading}
        >
          <ThumbDown filled={userVote === -1} className="w-[18px] h-[18px]" />
        </button>
      </div>
    );
  }

  // ── Full mode (SongDetail) ──

  // Premium user with quota (or already diamond-liked): diamond-styled button + hold/hover panel
  if (showDiamond) {
    return (
      <div className="flex items-center gap-3">
        <div className="relative">
          {/* Main button: diamond-styled, quick click = like, hold/hover = panel */}
          <button
            onMouseDown={handleBtnMouseDown}
            onMouseUp={handleBtnMouseUp}
            onMouseEnter={handleBtnMouseEnter}
            onMouseLeave={handleBtnMouseLeave}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 select-none ${
              userVote === 1 || userHasDiamondLiked
                ? "bg-cyan-400/15 border border-cyan-400/20"
                : "bg-white/[0.04] border border-white/[0.06] hover:border-cyan-400/20 hover:bg-cyan-400/10"
            }`}
            disabled={loading && diamondLoading}
          >
            <span className="diamond-shimmer-icon">
              <ThumbUp filled={true} className="w-5 h-5" />
            </span>
            <span className="text-[#00ec97]">{upvotes + diamondLikeCount}</span>
          </button>

          {/* Panel: diamond like + regular like */}
          {showPanel && (
            <div
              className="absolute top-full left-0 mt-1.5 z-50 bg-slate-900/95 border border-white/10 rounded-xl shadow-xl p-1.5 space-y-1"
              onMouseEnter={handlePanelEnter}
              onMouseLeave={handlePanelLeave}
            >
              <button
                onClick={() => { handleDiamondLike(); setShowPanel(false); }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 w-full whitespace-nowrap ${
                  userHasDiamondLiked
                    ? "bg-cyan-400/10 text-cyan-300"
                    : "text-slate-300 hover:bg-cyan-400/10 hover:text-cyan-300"
                }`}
                disabled={diamondLoading}
              >
                <span className="diamond-shimmer-icon">
                  <ThumbUp filled={true} className="w-4 h-4" />
                </span>
                {userHasDiamondLiked ? "Remove Diamond Like" : "Boost with Diamond Like"}
              </button>
              <button
                onClick={() => { handleVote(1); setShowPanel(false); }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 w-full whitespace-nowrap ${
                  userVote === 1
                    ? "text-[#00ec97] bg-[#00ec97]/10"
                    : "text-slate-400 hover:text-[#00ec97] hover:bg-[#00ec97]/10"
                }`}
                disabled={loading}
              >
                <ThumbUp filled={userVote === 1} className="w-4 h-4" />
                {userVote === 1 ? "Remove regular like" : "Regular like"}
              </button>
            </div>
          )}
        </div>

        {/* Downvote */}
        <button
          onClick={() => handleVote(-1)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
            userVote === -1
              ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
              : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:text-rose-400 hover:border-rose-500/20 hover:bg-rose-500/10"
          }`}
          disabled={loading}
        >
          <ThumbDown filled={userVote === -1} className="w-5 h-5" />
          {downvotes > 0 && downvotes}
        </button>
      </div>
    );
  }

  // Non-premium user: standard layout
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => handleVote(1)}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
          userVote === 1
            ? "bg-[#00ec97]/15 text-[#00ec97] border border-[#00ec97]/20"
            : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:text-[#00ec97] hover:border-[#00ec97]/20 hover:bg-[#00ec97]/10"
        }`}
        disabled={loading}
      >
        <ThumbUp filled={userVote === 1} className="w-5 h-5" />
        {upvotes > 0 && upvotes}
      </button>
      <button
        onClick={() => handleVote(-1)}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
          userVote === -1
            ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
            : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:text-rose-400 hover:border-rose-500/20 hover:bg-rose-500/10"
        }`}
        disabled={loading}
      >
        <ThumbDown filled={userVote === -1} className="w-5 h-5" />
        {downvotes > 0 && downvotes}
      </button>
    </div>
  );
}
