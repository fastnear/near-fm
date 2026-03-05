"use client";

import { useState, useEffect } from "react";
import { followUser, unfollowUser, getFollowStatus } from "@/lib/api";

interface Props {
  accountId: string;
  currentUser: string | null;
  onFollowChange?: (isFollowing: boolean) => void;
}

export function FollowButton({ accountId, currentUser, onFollowChange }: Props) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!currentUser || currentUser === accountId) return;
    getFollowStatus(accountId)
      .then((data) => {
        setIsFollowing(data.is_following);
        setLoaded(true);
        onFollowChange?.(data.is_following);
      })
      .catch(console.error);
  }, [accountId, currentUser]);

  if (!currentUser || currentUser === accountId || !loaded) return null;

  const handleClick = async () => {
    setLoading(true);
    try {
      if (isFollowing) {
        await unfollowUser(accountId);
        setIsFollowing(false);
        onFollowChange?.(false);
      } else {
        await followUser(accountId);
        setIsFollowing(true);
        onFollowChange?.(true);
      }
    } catch (e) {
      console.error("Follow action failed:", e);
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`px-4 py-2 text-sm rounded-xl transition-all disabled:opacity-50 ${
        isFollowing
          ? "text-purple-400 bg-purple-500/10 border border-purple-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
          : "text-slate-400 bg-white/[0.04] border border-white/[0.06] hover:text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/20"
      }`}
    >
      {loading ? "..." : isFollowing ? "Following" : "Follow"}
    </button>
  );
}
