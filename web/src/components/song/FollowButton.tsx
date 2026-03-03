"use client";

import { useState, useEffect } from "react";
import { followUser, unfollowUser, getFollowStatus } from "@/lib/api";

interface Props {
  accountId: string;
  currentUser: string | null;
}

export function FollowButton({ accountId, currentUser }: Props) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!currentUser || currentUser === accountId) return;
    getFollowStatus(accountId)
      .then((data) => {
        setIsFollowing(data.is_following);
        setLoaded(true);
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
      } else {
        await followUser(accountId);
        setIsFollowing(true);
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
      className={`inline-block text-xs px-2.5 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
        isFollowing
          ? "bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20"
          : "bg-purple-500/10 text-purple-400 border-purple-500/15 hover:bg-purple-500/20"
      }`}
    >
      {isFollowing ? "Following" : "+ Follow"}
    </button>
  );
}
