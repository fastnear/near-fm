"use client";

import { useState } from "react";
import type { Song } from "@/types";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { voteSong } from "@/lib/api";

interface Props {
  song: Song;
  compact?: boolean;
}

export function VoteButtons({ song, compact }: Props) {
  const { accountId, signIn } = useNearWallet();
  const [upvotes, setUpvotes] = useState(song.upvotes);
  const [downvotes, setDownvotes] = useState(song.downvotes);
  const [userVote, setUserVote] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const handleVote = async (value: 1 | -1) => {
    if (!accountId) {
      signIn();
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const result = await voteSong(song.uuid, value);
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
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleVote(1)}
          className={`p-1 rounded-md transition-all duration-200 ${
            userVote === 1
              ? "text-emerald-400 bg-emerald-400/10"
              : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-400/10"
          }`}
          disabled={loading}
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <span
          className={`text-xs font-semibold min-w-[20px] text-center tabular-nums ${
            net > 0 ? "text-emerald-400" : net < 0 ? "text-rose-400" : "text-slate-500"
          }`}
        >
          {net}
        </span>
        <button
          onClick={() => handleVote(-1)}
          className={`p-1 rounded-md transition-all duration-200 ${
            userVote === -1
              ? "text-rose-400 bg-rose-400/10"
              : "text-slate-500 hover:text-rose-400 hover:bg-rose-400/10"
          }`}
          disabled={loading}
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleVote(1)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 ${
          userVote === 1
            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
            : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:text-emerald-400 hover:border-emerald-500/20 hover:bg-emerald-500/10"
        }`}
        disabled={loading}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
        </svg>
        {upvotes}
      </button>
      <button
        onClick={() => handleVote(-1)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 ${
          userVote === -1
            ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
            : "bg-white/[0.04] text-slate-400 border border-white/[0.06] hover:text-rose-400 hover:border-rose-500/20 hover:bg-rose-500/10"
        }`}
        disabled={loading}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
        {downvotes}
      </button>
    </div>
  );
}
