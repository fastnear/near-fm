"use client";

import { useState, useEffect } from "react";
import type { Song } from "@/types";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { voteSong, getUserVote } from "@/lib/api";

interface Props {
  song: Song;
  compact?: boolean;
}

// Thumbs up SVG (outline when inactive, filled when active)
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

// Thumbs down SVG
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

export function VoteButtons({ song, compact }: Props) {
  const { accountId, isAuthenticated, signIn, completeSignIn } = useNearWallet();
  const [upvotes, setUpvotes] = useState(song.upvotes);
  const [downvotes, setDownvotes] = useState(song.downvotes);
  const [userVote, setUserVote] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated && song.uuid) {
      getUserVote(song.uuid)
        .then((r) => {
          setUserVote(r.user_vote);
          setUpvotes(r.upvotes);
          setDownvotes(r.downvotes);
        })
        .catch(() => {});
    }
  }, [isAuthenticated, song.uuid]);

  const handleVote = async (value: 1 | -1) => {
    if (!isAuthenticated) {
      if (accountId) { completeSignIn(); } else { signIn(); }
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      // Toggle: if already voted this way, remove the vote
      const sendValue = userVote === value ? 0 : value;
      const result = await voteSong(song.uuid, sendValue as 1 | -1 | 0);
      setUpvotes(result.upvotes);
      setDownvotes(result.downvotes);
      setUserVote(result.user_vote);
    } catch (e) {
      console.error("Vote failed:", e);
    }
    setLoading(false);
  };

  const net = upvotes - downvotes;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => handleVote(1)}
          className={`p-1.5 rounded-lg transition-all duration-200 ${
            userVote === 1
              ? "text-emerald-400 bg-emerald-400/15"
              : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-400/10"
          }`}
          disabled={loading}
        >
          <ThumbUp filled={userVote === 1} className="w-5 h-5" />
        </button>
        <span
          className={`text-sm font-semibold min-w-[24px] text-center tabular-nums ${
            net > 0 ? "text-emerald-400" : net < 0 ? "text-rose-400" : "text-slate-500"
          }`}
        >
          {net}
        </span>
        <button
          onClick={() => handleVote(-1)}
          className={`p-1.5 rounded-lg transition-all duration-200 ${
            userVote === -1
              ? "text-rose-400 bg-rose-400/15"
              : "text-slate-500 hover:text-rose-400 hover:bg-rose-400/10"
          }`}
          disabled={loading}
        >
          <ThumbDown filled={userVote === -1} className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => handleVote(1)}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
          userVote === 1
            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
            : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:text-emerald-400 hover:border-emerald-500/20 hover:bg-emerald-500/10"
        }`}
        disabled={loading}
      >
        <ThumbUp filled={userVote === 1} className="w-5 h-5" />
        {upvotes}
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
        {downvotes}
      </button>
    </div>
  );
}
