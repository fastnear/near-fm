"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBlockedUsers, unblockUser } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface BlockedUser {
  account_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export function BlockedUsers() {
  const { user } = useAuth();
  const accountId = user?.slug;
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    getBlockedUsers(accountId)
      .then(setBlocked)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accountId]);

  const handleUnblock = async (targetAccountId: string) => {
    setUnblocking(targetAccountId);
    try {
      await unblockUser(targetAccountId);
      setBlocked((prev) => prev.filter((u) => u.account_id !== targetAccountId));
    } catch (e) {
      console.error("Failed to unblock user:", e);
    }
    setUnblocking(null);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full skeleton" />
              <div className="flex-1 space-y-2">
                <div className="h-4 skeleton rounded w-40" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Blocked users&apos; songs won&apos;t appear in your feed or radio. Manage your feed content filters from the Customize button on the main page.
      </p>

      {blocked.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 text-slate-700">&#128101;</div>
          <p className="text-slate-400 text-lg">No blocked users</p>
          <p className="text-slate-500 text-sm mt-2">
            Users you block will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {blocked.map((user) => (
            <div
              key={user.account_id}
              className="glass-card rounded-xl p-4 flex items-center gap-3"
            >
              <Link href={`/profile/${user.account_id}`} className="shrink-0">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.display_name || user.account_id}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-sm font-bold text-white">
                    {(user.display_name || user.account_id).charAt(0).toUpperCase()}
                  </div>
                )}
              </Link>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/profile/${user.account_id}`}
                  className="text-sm text-white hover:text-purple-400 transition-colors truncate block"
                >
                  {user.display_name || user.account_id}
                </Link>
                {user.display_name && (
                  <p className="text-xs text-slate-500 truncate">{user.account_id}</p>
                )}
              </div>
              <button
                onClick={() => handleUnblock(user.account_id)}
                disabled={unblocking === user.account_id}
                className="px-3 py-1.5 text-xs rounded-lg border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06] transition disabled:opacity-50 shrink-0"
              >
                {unblocking === user.account_id ? "..." : "Unblock"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
