"use client";

import React from "react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getUserProfile, getNotifications, markAllNotificationsRead, getReports, reviewReport, moderateSong, getPlaylists, createPlaylist, updatePlaylist, deletePlaylist, getPlaylistSongs, removeSongFromPlaylist, reorderPlaylistSongs, getDiamondLikesRemaining, restoreWallet } from "@/lib/api";
import { depositAction, withdrawAction, getBalance } from "@/lib/near/contract";
import { SongCard } from "@/components/song/SongCard";
import { BlockedUsers } from "@/components/cabinet/BlockedUsers";
import type { Song, Notification, Playlist } from "@/types";
import { prepareFastFSUpload, uploadToFastFS, uploadToFastFSViaRelayer, getRelativePath, getFastFSUrl } from "@/lib/near/fastfs";

// ── Helpers ──

const YOCTO_PER_NEAR = BigInt("1000000000000000000000000"); // 1e24

function nearToYocto(near: string): string {
  const parts = near.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(24, "0").slice(0, 24);
  const yocto = BigInt(whole) * YOCTO_PER_NEAR + BigInt(frac);
  return yocto.toString();
}

function yoctoToNear(yocto: string): string {
  if (!yocto || yocto === "0") return "0.0000";
  const str = yocto.padStart(25, "0");
  const intPart = str.slice(0, str.length - 24) || "0";
  const fracPart = str.slice(str.length - 24, str.length - 20);
  return `${intPart}.${fracPart}`;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ── Tab types ──

type TabKey = "balance" | "songs" | "playlists" | "wallet" | "feed" | "notifications" | "reports";

const BASE_TABS: { key: TabKey; label: string }[] = [
  { key: "balance", label: "Balance" },
  { key: "songs", label: "My Songs" },
  { key: "wallet", label: "Wallet" },
  { key: "feed", label: "Blocked Users" },
  { key: "notifications", label: "Notifications" },
];

const PREMIUM_TABS: { key: TabKey; label: string }[] = [
  { key: "playlists", label: "Playlists" },
];

const ADMIN_TABS: { key: TabKey; label: string }[] = [
  { key: "reports", label: "Reports" },
];

// ── Main component ──

export default function CabinetPage() {
  const { user, isAuthenticated, loading: authLoading, signInWithGoogle, signOut: authSignOut } = useAuth();
  const { accountId, connectAndSignIn, loading: walletLoading } = useNearWallet();
  const [activeTab, setActiveTab] = useState<TabKey>("balance");
  const [diamondRemaining, setDiamondRemaining] = useState<number | null>(null);
  const isAdmin = user?.is_admin;
  const isPremium = user?.is_premium;
  const baseTabs = isPremium
    ? [...BASE_TABS.slice(0, 2), ...PREMIUM_TABS, ...BASE_TABS.slice(2)]
    : BASE_TABS;
  const TABS = isAdmin ? [...baseTabs, ...ADMIN_TABS] : baseTabs;
  const userSlug = user?.slug;

  useEffect(() => {
    if (isPremium) {
      getDiamondLikesRemaining().then(r => setDiamondRemaining(r.diamond_likes_remaining_today)).catch(() => {});
    }
  }, [isPremium]);


  if (authLoading || walletLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <div className="inline-block w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 mt-4">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <div className="glass-card rounded-3xl p-12 max-w-md mx-auto">
          <div className="text-5xl mb-4 text-slate-700">&#128274;</div>
          <h1 className="text-xl font-bold text-white mb-2">Sign in</h1>
          <p className="text-slate-400 text-sm mb-6">
            Sign in to access your dashboard, manage your balance, and view your songs.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={signInWithGoogle}
              className="btn-primary px-6 py-3 rounded-xl flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              </svg>
              Sign in with Google
            </button>
            <button
              onClick={connectAndSignIn}
              className="px-6 py-3 rounded-xl text-sm text-slate-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all"
            >
              Sign in with NEAR Wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSignOut = () => {
    authSignOut();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">My Cabinet</h1>
        <div className="flex items-center gap-3">
          {(accountId || user?.near_account_id) && (
            <span className="text-xs font-mono text-slate-500">{accountId || user?.near_account_id}</span>
          )}
          <button
            onClick={handleSignOut}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Premium status */}
      {isPremium ? (
        <div className="glass-card rounded-2xl p-5 mb-6 border border-cyan-500/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">✦</span>
              <h2 className="text-lg font-bold diamond-shimmer">Premium</h2>
            </div>
            <Link href="/premium" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Extend →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="space-y-1">
              <div className="text-slate-400">Daily AI credits</div>
              <div className="text-cyan-400 font-semibold">
                {user?.daily_credits_remaining ?? 0} / 40
              </div>
              <div className="text-xs text-slate-500">Resets midnight UTC</div>
            </div>
            <div className="space-y-1">
              <div className="text-slate-400">Diamond Likes today</div>
              <div className="text-white font-semibold">
                {diamondRemaining !== null ? `${diamondRemaining} / 5` : "..."}
              </div>
              <div className="text-xs text-slate-500">Boosts songs in feed</div>
            </div>
            <div className="space-y-1">
              <div className="text-slate-400">Playlists</div>
              <div className="text-[#00ec97] font-semibold">Available</div>
              <div className="text-xs text-slate-500">Create & share playlists</div>
            </div>
            <div className="space-y-1">
              <div className="text-slate-400">Active until</div>
              <div className="text-white font-semibold">
                {user?.premium_until ? new Date(user.premium_until).toLocaleDateString() : "Active"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-5 mb-6 border border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-300 mb-1">Get Premium — $10/month</h2>
              <p className="text-sm text-slate-500">
                40 free AI credits/day · 3 songs/day · Diamond Likes · Playlists
              </p>
            </div>
            <Link
              href="/premium"
              className="shrink-0 ml-4 px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 transition-all"
            >
              Upgrade
            </Link>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 glass rounded-2xl p-1 mb-8 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition whitespace-nowrap ${
              activeTab === tab.key
                ? "bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-white border border-purple-500/20 shadow-lg shadow-purple-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "balance" && <BalanceTab />}
      {activeTab === "songs" && <MySongsTab userSlug={userSlug} />}
      {activeTab === "wallet" && <WalletKeyTab />}
      {activeTab === "playlists" && isPremium && <PlaylistsTab />}
      {activeTab === "feed" && <BlockedUsers />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "reports" && isAdmin && <ReportsTab />}
    </div>
  );
}

// ── Balance Tab ──

function BalanceTab() {
  const { user, isPremium } = useAuth();
  const { accountId, viewMethod, callFunction } = useNearWallet();
  const [nearBalance, setNearBalance] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  // Fetch legacy NEAR virtual balance (only for NEAR wallet users)
  useEffect(() => {
    if (!accountId) return;
    const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.near";
    getBalance(
      viewMethod as (params: { contractId: string; method: string; args: Record<string, unknown> }) => Promise<string>,
      accountId
    ).then((bal) => {
      const b = typeof bal === "string" ? bal : String(bal);
      if (b !== "0" && BigInt(b) > 0) setNearBalance(b);
    }).catch(() => {});
  }, [accountId, viewMethod]);

  const handleNearWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0 || !callFunction) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const yocto = nearToYocto(withdrawAmount);
      const action = withdrawAction(yocto);
      await callFunction({
        contractId: action.contractId, method: action.method, args: action.args, gas: action.gas,
      });
      setWithdrawAmount("");
      setActionMsg({ type: "success", text: `Withdrew ${withdrawAmount} NEAR` });
      setNearBalance(null);
    } catch (e: any) {
      setActionMsg({ type: "error", text: e.message || "Withdraw failed" });
    }
    setActionLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* AI Credits */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-white font-semibold">AI Credits</h3>
          <p className="text-2xl font-bold text-white">
            {user?.credit_balance?.toLocaleString() ?? 0}
          </p>
        </div>
        <p className="text-xs text-slate-400 mb-3">Used for AI music generation (12 credits per song)</p>
        {user?.daily_credits_remaining != null && user.daily_credits_remaining > 0 && (
          <p className="text-xs text-cyan-400 mb-3">
            + {user.daily_credits_remaining} free daily credits remaining (premium)
          </p>
        )}
        <div className="flex gap-2">
          <Link href="/balance" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.08] text-slate-300 hover:bg-white/[0.12] border border-white/[0.08] transition-all">
            Top Up Balance
          </Link>
          {!isPremium && (
            <Link href="/premium" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/15 border border-cyan-500/20 transition-all">
              Get 40 free/day with Premium →
            </Link>
          )}
        </div>
      </div>

      {/* Legacy NEAR virtual balance — only shown for NEAR users with balance > 0 */}
      {accountId && nearBalance && (
        <div className="glass-card rounded-2xl p-6 border border-amber-500/20 bg-amber-500/[0.04]">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span className="text-sm font-medium text-amber-300">Legacy NEAR Balance</span>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            You have <span className="text-white font-medium">{yoctoToNear(nearBalance)} NEAR</span> in the old virtual balance.
            We recommend withdrawing it to your wallet.
          </p>
          <div className="flex gap-2">
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={actionLoading}
              className="flex-1 border border-white/[0.08] bg-white/[0.04] rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition disabled:opacity-50"
            />
            <button
              onClick={() => setWithdrawAmount(yoctoToNear(nearBalance))}
              className="px-2 py-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg"
            >
              Max
            </button>
            <button
              onClick={handleNearWithdraw}
              disabled={actionLoading || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
              className="px-4 py-2 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 disabled:opacity-30 transition-all"
            >
              {actionLoading ? "..." : "Withdraw"}
            </button>
          </div>
          {actionMsg && (
            <p className={`text-xs mt-2 ${actionMsg.type === "error" ? "text-red-400" : "text-green-400"}`}>{actionMsg.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── My Songs Tab ──

function MySongsTab({ userSlug }: { userSlug?: string }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userSlug) return;
    const load = async () => {
      setLoading(true);
      try {
        const data: any = await getUserProfile(userSlug);
        setSongs(data.songs ?? []);
      } catch (e) {
        console.error("Failed to load songs:", e);
      }
      setLoading(false);
    };
    load();
  }, [userSlug]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl">
            <div className="aspect-square skeleton rounded-t-xl" />
            <div className="p-3 space-y-2">
              <div className="h-4 skeleton rounded w-3/4" />
              <div className="h-3 skeleton rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 text-slate-700">&#9835;</div>
        <p className="text-slate-400 text-lg">You haven&apos;t uploaded any songs yet</p>
        <p className="text-slate-500 text-sm mt-2">
          Upload your first AI-generated song to get started!
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {songs.map((song) => (
        <SongCard key={song.uuid} song={song} />
      ))}
    </div>
  );
}

// ── Notifications Tab ──

function NotificationIcon({ type }: { type: string }) {
  switch (type) {
    case "tip_received":
      return (
        <svg className="w-5 h-5 text-[#00ec97]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "song_reported":
      return (
        <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    case "new_bounty":
      return (
        <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "mention":
      return (
        <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 11-8 0 4 4 0 018 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
        </svg>
      );
    case "song_hidden":
      return (
        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
        </svg>
      );
    case "song_validated":
      return (
        <svg className="w-5 h-5 text-[#00ec97]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "bounty_awarded":
      return (
        <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      );
    case "bounty_not_awarded":
      return (
        <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "submission_to_request":
      return (
        <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      );
    case "comment":
      return (
        <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      );
    case "new_follower":
      return (
        <svg className="w-5 h-5 text-pink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
        </svg>
      );
    case "followed_user_new_song":
      return (
        <svg className="w-5 h-5 text-cyan-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      );
    case "blog_post":
      return (
        <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
      );
    default:
      return (
        <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      );
  }
}

function notificationText(notif: Notification): React.ReactNode {
  const data = notif.data;

  switch (notif.type) {
    case "tip_received": {
      const amountYocto = data.amount_yocto as string | undefined;
      const amountUsdCents = data.amount_usd_cents as number | undefined;
      const from = (data.from_account || data.from_account_id) as string | undefined;
      const songTitle = data.song_title as string | undefined;
      const songUuid = data.song_uuid as string | undefined;
      const profileSlug = data.profile_slug as string | undefined;
      const tipDisplay = amountUsdCents
        ? `$${(amountUsdCents / 100).toFixed(2)}`
        : amountYocto
          ? `${yoctoToNear(amountYocto)} NEAR`
          : "";
      return (
        <>
          You received a tip{tipDisplay ? ` of ${tipDisplay}` : ""}
          {from ? <> from <Link href={`/profile/${from}`} className="text-purple-400 hover:underline">{from}</Link></> : ""}
          {songTitle && songUuid ? <> for <Link href={`/song/${songUuid}`} className="text-purple-400 hover:underline">&quot;{songTitle}&quot;</Link></> : ""}
          {profileSlug && !songUuid ? " on your profile" : ""}
        </>
      );
    }
    case "song_reported":
      return `Your song has been reported${data.reason ? `: ${data.reason}` : ""}`;
    case "song_hidden":
      return "Your song has been hidden by a moderator";
    case "bounty_awarded": {
      const bountyAmount = data.bounty_amount_yocto as string | undefined;
      const nearBounty = bountyAmount ? yoctoToNear(bountyAmount) : "?";
      const reqTitle = data.request_title as string | undefined;
      return `Congratulations! Your song won the bounty of ${nearBounty} NEAR${reqTitle ? ` for "${reqTitle}"` : ""}. The reward has been added to your virtual balance.`;
    }
    case "bounty_not_awarded": {
      const reqTitle2 = data.request_title as string | undefined;
      return `The bounty${reqTitle2 ? ` for "${reqTitle2}"` : ""} has been awarded to another song. Thanks for participating — keep submitting to other requests!`;
    }
    case "submission_to_request":
      return `A new song was submitted to your request${data.song_title ? `: "${data.song_title}"` : ""}`;
    case "song_validated": {
      const songTitle = data.song_title as string | undefined;
      return `Your song${songTitle ? ` "${songTitle}"` : ""} is now live!`;
    }
    case "audio_validation_failed":
      return `Audio validation failed${data.reason ? `: ${data.reason}` : ""}`;
    case "comment": {
      const songTitle = data.song_title as string | undefined;
      const songUuid = data.song_uuid as string | undefined;
      const commenter = data.commenter_account_id as string | undefined;
      if (!commenter && data.message) return String(data.message);
      return (
        <>
          {commenter ? <Link href={`/profile/${commenter}`} className="text-purple-400 hover:underline">{commenter}</Link> : "Someone"}
          {" commented on "}
          {songTitle && songUuid ? (
            <Link href={`/song/${songUuid}`} className="text-purple-400 hover:underline">&quot;{songTitle}&quot;</Link>
          ) : "your song"}
        </>
      );
    }
    case "new_bounty": {
      const requesterSlug = data.requester_slug as string | undefined;
      const reqTitle = data.request_title as string | undefined;
      const reqUuid = data.request_uuid as string | undefined;
      const bountyNear = data.bounty_near as string | undefined;
      return (
        <>
          {requesterSlug ? <Link href={`/profile/${requesterSlug}`} className="text-purple-400 hover:underline">{requesterSlug}</Link> : "Someone"}
          {" created a bounty "}
          {reqTitle && reqUuid ? (
            <Link href={`/requests/${reqUuid}`} className="text-purple-400 hover:underline">&quot;{reqTitle}&quot;</Link>
          ) : reqTitle ? `"${reqTitle}"` : ""}
          {bountyNear ? ` (${bountyNear} NEAR)` : ""}
        </>
      );
    }
    case "mention": {
      const mentioner = data.mentioner as string | undefined;
      const mSongTitle = data.song_title as string | undefined;
      const mSongUuid = data.song_uuid as string | undefined;
      return (
        <>
          {mentioner ? <Link href={`/profile/${mentioner}`} className="text-cyan-400 hover:underline">{mentioner}</Link> : "Someone"}
          {" mentioned you in a comment on "}
          {mSongTitle && mSongUuid ? (
            <Link href={`/song/${mSongUuid}`} className="text-cyan-400 hover:underline">&quot;{mSongTitle}&quot;</Link>
          ) : "a song"}
        </>
      );
    }
    case "new_follower": {
      const followerSlug = data.follower_slug as string | undefined;
      return (
        <>
          <Link href={`/profile/${followerSlug}`} className="text-purple-400 hover:underline">{followerSlug}</Link>
          {" started following you"}
        </>
      );
    }
    case "followed_user_new_song": {
      const uploaderSlug = data.uploader_slug as string | undefined;
      const songTitle = data.song_title as string | undefined;
      const songUuid = data.song_uuid as string | undefined;
      return (
        <>
          <Link href={`/profile/${uploaderSlug}`} className="text-purple-400 hover:underline">{uploaderSlug}</Link>
          {" uploaded a new song "}
          {songTitle && songUuid ? (
            <Link href={`/song/${songUuid}`} className="text-purple-400 hover:underline">&quot;{songTitle}&quot;</Link>
          ) : ""}
        </>
      );
    }
    case "profile_comment": {
      const commenter = data.commenter_account_id as string | undefined;
      return (
        <>
          {commenter ? <Link href={`/profile/${commenter}`} className="text-purple-400 hover:underline">{commenter}</Link> : "Someone"}
          {" left a comment on your profile"}
        </>
      );
    }
    case "profile_tip": {
      const fromAccount = data.from_account as string | undefined;
      const amountYocto = data.amount_yocto as string | undefined;
      const nearStr = amountYocto ? yoctoToNear(amountYocto) : "?";
      return (
        <>
          {fromAccount ? <Link href={`/profile/${fromAccount}`} className="text-amber-400 hover:underline">{fromAccount}</Link> : "Someone"}
          {` sent you ${nearStr} NEAR`}
        </>
      );
    }
    case "premium_gifted": {
      const fromAccount = data.from_account_id as string | undefined;
      const daysAdded = data.days_added as number | undefined;
      return (
        <>
          {fromAccount ? <Link href={`/profile/${fromAccount}`} className="text-cyan-400 hover:underline">{fromAccount}</Link> : "Someone"}
          {` gifted you ${daysAdded ?? "?"} days of `}
          <span className="diamond-shimmer font-medium">Premium</span>
          {" ✦"}
        </>
      );
    }
    case "blog_post": {
      const authorSlug = data.author_slug as string | undefined;
      const authorName = (data.author_display_name as string | undefined) || authorSlug;
      const postId = data.post_id as number | undefined;
      return (
        <>
          <Link href={`/profile/${authorSlug}`} className="text-purple-400 hover:underline">{authorName}</Link>
          {" published a new "}
          {authorSlug && postId ? (
            <Link href={`/profile/${authorSlug}/blog/${postId}`} className="text-purple-400 hover:underline">blog post</Link>
          ) : "blog post"}
        </>
      );
    }
    case "reply": {
      const fromAccount = data.from_account as string | undefined;
      const parentType = data.parent_type as string | undefined;
      return (
        <>
          {fromAccount ? <Link href={`/profile/${fromAccount}`} className="text-purple-400 hover:underline">{fromAccount}</Link> : "Someone"}
          {` replied to your ${parentType === "blog_post" ? "blog post" : "comment"}`}
        </>
      );
    }
    default:
      return `You have a new notification (${notif.type})`;
  }
}

function NotificationsTab() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications();
      setNotifications(data);

      // Auto-mark all as read & clear header badge
      if (data.some((n: Notification) => !n.is_read)) {
        markAllNotificationsRead()
          .then(() => window.dispatchEvent(new Event("nearfm_notifications_read")))
          .catch(() => {});
      }
    } catch (e) {
      console.error("Failed to load notifications:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full skeleton" />
              <div className="flex-1 space-y-2">
                <div className="h-4 skeleton rounded w-3/4" />
                <div className="h-3 skeleton rounded w-1/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 text-slate-700">&#128276;</div>
        <p className="text-slate-400 text-lg">No notifications</p>
        <p className="text-slate-500 text-sm mt-2">
          You&apos;re all caught up!
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Notification list */}
      <div className="space-y-2">
        {notifications.map((notif) => (
          <div
            key={notif.id}
            className={`glass-card rounded-xl p-4 transition ${
              !notif.is_read ? "border-l-4 border-l-purple-500" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Type icon */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                !notif.is_read ? "bg-purple-500/10" : "bg-white/[0.06]"
              }`}>
                <NotificationIcon type={notif.type} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!notif.is_read ? "text-white font-medium" : "text-slate-300"}`}>
                  {notificationText(notif)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {timeAgo(notif.created_at)}
                </p>
              </div>

              {/* Unread indicator dot */}
              {!notif.is_read && (
                <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0 mt-1.5" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Playlists Tab (Premium) ──

function PlaylistsTab() {
  const { user } = useAuth();
  const { accountId, callFunction } = useNearWallet();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [rssCopied, setRssCopied] = useState(false);
  const [isApple, setIsApple] = useState(false);

  useEffect(() => {
    setIsApple(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);
  const [coverUploading, setCoverUploading] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPlaylists();
      setPlaylists(data);
    } catch (e) {
      console.error("Failed to load playlists:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  const loadSongs = useCallback(async (playlist: Playlist) => {
    setSongsLoading(true);
    try {
      const data = await getPlaylistSongs(playlist.uuid);
      setSongs(data);
    } catch (e) {
      console.error("Failed to load playlist songs:", e);
    }
    setSongsLoading(false);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { playlist } = await createPlaylist({ name: newName.trim() });
      setPlaylists((prev) => [playlist, ...prev]);
      setNewName("");
    } catch (e: any) {
      alert(e.message || "Failed to create playlist");
    }
    setCreating(false);
  };

  const handleDelete = async (playlist: Playlist) => {
    if (!window.confirm(`Delete playlist "${playlist.name}"?`)) return;
    try {
      await deletePlaylist(playlist.uuid);
      setPlaylists((prev) => prev.filter((p) => p.uuid !== playlist.uuid));
      if (selectedPlaylist?.uuid === playlist.uuid) setSelectedPlaylist(null);
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const handleRemoveSong = async (songUuid: string) => {
    if (!selectedPlaylist) return;
    try {
      await removeSongFromPlaylist(selectedPlaylist.uuid, songUuid);
      setSongs((prev) => prev.filter((s) => s.uuid !== songUuid));
      setPlaylists((prev) =>
        prev.map((p) =>
          p.uuid === selectedPlaylist.uuid ? { ...p, song_count: p.song_count - 1 } : p
        )
      );
      setSelectedPlaylist((prev) => prev ? { ...prev, song_count: prev.song_count - 1 } : prev);
    } catch (e) {
      console.error("Remove song failed:", e);
    }
  };

  const handleMoveSong = async (songUuid: string, direction: "up" | "down") => {
    if (!selectedPlaylist) return;
    const idx = songs.findIndex((s) => s.uuid === songUuid);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= songs.length) return;

    const newSongs = [...songs];
    [newSongs[idx], newSongs[swapIdx]] = [newSongs[swapIdx], newSongs[idx]];
    setSongs(newSongs);

    try {
      await reorderPlaylistSongs(selectedPlaylist.uuid, newSongs.map((s) => s.uuid));
    } catch (e) {
      console.error("Reorder failed:", e);
      setSongs(songs); // revert
    }
  };

  const handleSaveName = async () => {
    if (!selectedPlaylist || !editName.trim()) return;
    try {
      const { playlist } = await updatePlaylist(selectedPlaylist.uuid, { name: editName.trim() });
      setSelectedPlaylist(playlist);
      setPlaylists((prev) => prev.map((p) => (p.uuid === playlist.uuid ? playlist : p)));
      setEditingName(false);
    } catch (e) {
      console.error("Update name failed:", e);
    }
  };

  const handleSaveDesc = async () => {
    if (!selectedPlaylist) return;
    try {
      const { playlist } = await updatePlaylist(selectedPlaylist.uuid, { description: editDesc });
      setSelectedPlaylist(playlist);
      setPlaylists((prev) => prev.map((p) => (p.uuid === playlist.uuid ? playlist : p)));
      setEditingDesc(false);
    } catch (e) {
      console.error("Update description failed:", e);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedPlaylist) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file"); return; }
    if (file.size > 1024 * 1024) { alert("Image must be under 1MB"); return; }

    setCoverUploading(true);
    try {
      let url: string;
      if (accountId && callFunction) {
        // Direct upload via NEAR wallet
        const content = new Uint8Array(await file.arrayBuffer());
        const hash = await import("@/lib/near/fastfs").then((m) => m.computeFileHash(content));
        const relativePath = getRelativePath(await hash, file.type);
        const parts = prepareFastFSUpload(relativePath, file.type, content);
        await uploadToFastFS(
          (params) => callFunction(params) as Promise<string>,
          parts
        );
        await new Promise((r) => setTimeout(r, 3000));
        url = getFastFSUrl(accountId, relativePath);
      } else {
        // Upload via server relayer
        const result = await uploadToFastFSViaRelayer(file);
        await new Promise((r) => setTimeout(r, 3000));
        url = result.url;
      }
      const { playlist } = await updatePlaylist(selectedPlaylist.uuid, { cover_image_url: url });
      setSelectedPlaylist(playlist);
      setPlaylists((prev) => prev.map((p) => (p.uuid === playlist.uuid ? playlist : p)));
    } catch (err) {
      console.error("Cover upload failed:", err);
    }
    setCoverUploading(false);
  };

  // Detail view
  if (selectedPlaylist) {
    const rssUrl = `https://api.near.fm/feed/${selectedPlaylist.feed_token}`;
    const deepLink = `podcast://${rssUrl.replace("https://", "")}`;
    const isAuto = selectedPlaylist.is_auto;

    // Load songs on first open
    if (songs.length === 0 && !songsLoading && (selectedPlaylist.song_count > 0 || isAuto)) {
      loadSongs(selectedPlaylist);
    }

    return (
      <div className="space-y-6">
        {/* Back + title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSelectedPlaylist(null); setSongs([]); }}
            className="btn-ghost px-3 py-1.5 text-sm rounded-xl"
          >
            &larr; Back
          </button>
          <div className="flex-1 min-w-0">
            {editingName && !isAuto ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded-xl px-3 py-1.5 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                />
                <button onClick={handleSaveName} className="btn-primary px-3 py-1.5 text-sm rounded-xl">Save</button>
                <button onClick={() => setEditingName(false)} className="btn-ghost px-3 py-1.5 text-sm rounded-xl">Cancel</button>
              </div>
            ) : (
              <h2
                className={`text-xl font-bold text-white truncate ${!isAuto ? "cursor-pointer hover:text-purple-400 transition-colors" : ""}`}
                onClick={() => { if (!isAuto) { setEditName(selectedPlaylist.name); setEditingName(true); } }}
                title={isAuto ? "Auto playlist" : "Click to edit"}
              >
                {selectedPlaylist.name}
                {isAuto && <span className="ml-2 text-xs font-normal text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full">Auto</span>}
              </h2>
            )}
          </div>
          {!isAuto && (
            <button onClick={() => handleDelete(selectedPlaylist)} className="btn-ghost px-3 py-1.5 text-sm rounded-xl text-rose-400 hover:bg-rose-500/10">
              Delete
            </button>
          )}
        </div>

        {/* Cover + meta */}
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="relative w-40 h-40 rounded-2xl overflow-hidden ring-1 ring-white/[0.06] shrink-0">
            {selectedPlaylist.cover_image_url ? (
              <img src={selectedPlaylist.cover_image_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-cyan-900/50 flex items-center justify-center">
                <svg className="w-12 h-12 text-white/15" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
              </div>
            )}
            <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
              <span className="text-xs text-white font-medium">{coverUploading ? "Uploading..." : "Change Cover"}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} disabled={coverUploading || (!accountId && !user?.solana_address)} />
            </label>
          </div>

          <div className="flex-1 space-y-3">
            {/* Description */}
            {editingDesc ? (
              <div className="space-y-2">
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl px-3 py-2 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 focus:border-purple-500 focus:outline-none resize-none"
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveDesc} className="btn-primary px-3 py-1.5 text-sm rounded-xl">Save</button>
                  <button onClick={() => setEditingDesc(false)} className="btn-ghost px-3 py-1.5 text-sm rounded-xl">Cancel</button>
                </div>
              </div>
            ) : (
              <p
                className="text-sm text-slate-400 cursor-pointer hover:text-slate-300 transition-colors"
                onClick={() => { setEditDesc(selectedPlaylist.description || ""); setEditingDesc(true); }}
                title="Click to edit description"
              >
                {selectedPlaylist.description || "Add a description..."}
              </p>
            )}

            {isAuto ? (
              <p className="text-xs text-slate-500">{songs.length} song{songs.length !== 1 ? "s" : ""} (all your uploads)</p>
            ) : (
              <p className="text-xs text-slate-500">{selectedPlaylist.song_count} song{selectedPlaylist.song_count !== 1 ? "s" : ""}</p>
            )}

            {/* RSS links */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(rssUrl); setRssCopied(true); setTimeout(() => setRssCopied(false), 2000); }}
                className="btn-ghost px-3 py-1.5 text-xs rounded-xl flex items-center gap-1.5"
              >
                {rssCopied ? (
                  <svg className="w-3.5 h-3.5 text-[#00ec97]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
                {rssCopied ? "Copied!" : "Copy Playlist RSS URL"}
              </button>
              {isApple && (
                <a
                  href={deepLink}
                  className="btn-ghost px-3 py-1.5 text-xs rounded-xl flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 010-7.072m-2.828 9.9a9 9 0 010-12.728" />
                  </svg>
                  Open in Podcasts
                </a>
              )}
              {!isAuto && (
                <Link
                  href={`/playlist/${selectedPlaylist.uuid}`}
                  className="btn-ghost px-3 py-1.5 text-xs rounded-xl flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.102" />
                  </svg>
                  Public Page
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Songs list */}
        <div>
          <h3 className="text-sm font-semibold text-slate-400 mb-3">Songs</h3>
          {songsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="glass-card rounded-xl p-3 flex gap-3">
                  <div className="w-10 h-10 skeleton rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 skeleton rounded w-2/3" />
                    <div className="h-3 skeleton rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : songs.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">{isAuto ? "No uploaded songs yet." : "No songs yet. Add songs from any song page."}</p>
          ) : (
            <div className="space-y-2">
              {songs.map((song) => (
                <div key={song.uuid} className="glass-card rounded-xl p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded overflow-hidden shrink-0 ring-1 ring-white/[0.06]">
                    {song.cover_image_url ? (
                      <img src={song.cover_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-cyan-900/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/song/${song.uuid}`} className="text-sm text-white hover:text-purple-400 transition-colors truncate block">
                      {song.title}
                    </Link>
                    <p className="text-xs text-slate-500 truncate">{song.uploader_display_name || song.uploader_account_id}</p>
                  </div>
                  {!isAuto && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleMoveSong(song.uuid, "up")}
                        disabled={songs.indexOf(song) === 0}
                        className="p-1 rounded text-slate-500 hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-20 disabled:pointer-events-none"
                        title="Move up"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMoveSong(song.uuid, "down")}
                        disabled={songs.indexOf(song) === songs.length - 1}
                        className="p-1 rounded text-slate-500 hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-20 disabled:pointer-events-none"
                        title="Move down"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleRemoveSong(song.uuid)}
                        className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        title="Remove from playlist"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // List view
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl p-4">
            <div className="flex gap-3">
              <div className="w-16 h-16 skeleton rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="h-5 skeleton rounded w-1/2" />
                <div className="h-3 skeleton rounded w-1/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="New playlist name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          disabled={creating || playlists.length >= 3}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm border border-white/[0.08] bg-white/[0.04] text-slate-200 placeholder:text-slate-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim() || playlists.length >= 3}
          className="btn-primary px-5 py-2.5 rounded-xl text-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {creating ? "..." : "Create"}
        </button>
      </div>
      {playlists.length >= 3 && (
        <p className="text-xs text-slate-500">Maximum 3 playlists reached.</p>
      )}

      {/* Playlist list */}
      {playlists.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 text-slate-700">&#9835;</div>
          <p className="text-slate-400 text-lg">No playlists yet</p>
          <p className="text-slate-500 text-sm mt-2">Create your first playlist and add songs to it!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {playlists.map((playlist) => (
            <button
              key={playlist.uuid}
              onClick={() => { setSelectedPlaylist(playlist); setSongs([]); }}
              className="w-full glass-card rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.06] transition text-left"
            >
              <div className="w-16 h-16 rounded-xl overflow-hidden ring-1 ring-white/[0.06] shrink-0">
                {playlist.cover_image_url ? (
                  <img src={playlist.cover_image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-purple-900/50 to-cyan-900/50 flex items-center justify-center">
                    <svg className="w-6 h-6 text-white/15" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{playlist.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{playlist.song_count} song{playlist.song_count !== 1 ? "s" : ""}</p>
              </div>
              <svg className="w-5 h-5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reports Tab (Admin) ──

function ReportsTab() {
  const [reports, setReports] = useState<{
    id: number; song_id: number; reason: string; status: string;
    created_at: string; song_uuid: string; song_title: string;
    reporter_account_id: string;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchReportsList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getReports();
      setReports(data);
    } catch (e) {
      console.error("Failed to load reports:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReportsList();
  }, [fetchReportsList]);

  const handleAction = async (reportId: number, action: "dismiss" | "hide" | "delete") => {
    setActionLoading(reportId);
    try {
      if (action === "dismiss") {
        await reviewReport(reportId, { status: "dismissed" });
      } else {
        await reviewReport(reportId, { status: "reviewed", action });
      }
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (e) {
      console.error("Review failed:", e);
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-2">
                <div className="h-4 skeleton rounded w-3/4" />
                <div className="h-3 skeleton rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 text-slate-700">&#9989;</div>
        <p className="text-slate-400 text-lg">No pending reports</p>
        <p className="text-slate-500 text-sm mt-2">All reports have been reviewed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400 mb-4">{reports.length} pending report{reports.length !== 1 ? "s" : ""}</p>
      {reports.map((report) => (
        <div key={report.id} className="glass-card rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium">
                <a href={`/song/${report.song_uuid}`} className="hover:text-purple-400 transition-colors">
                  {report.song_title}
                </a>
              </p>
              <p className="text-sm text-slate-300 mt-1">&ldquo;{report.reason}&rdquo;</p>
              <p className="text-xs text-slate-500 mt-1">
                by {report.reporter_account_id} &middot; {timeAgo(report.created_at)}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => handleAction(report.id, "dismiss")}
                disabled={actionLoading === report.id}
                className="px-3 py-1.5 text-xs rounded-lg border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.06] transition disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                onClick={() => handleAction(report.id, "hide")}
                disabled={actionLoading === report.id}
                className="px-3 py-1.5 text-xs rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition disabled:opacity-50"
              >
                Hide
              </button>
              <button
                onClick={() => handleAction(report.id, "delete")}
                disabled={actionLoading === report.id}
                className="px-3 py-1.5 text-xs rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Wallet Key Tab ──

function WalletKeyTab() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [nearAccount, setNearAccount] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Try localStorage first, then server backup
    const localKey = localStorage.getItem("nearfm_outlayer_api_key");
    if (localKey) {
      setApiKey(localKey);
      setLoading(false);
      return;
    }
    restoreWallet()
      .then((data) => {
        if (data.api_key) {
          setApiKey(data.api_key);
          setNearAccount(data.near_account_id);
          localStorage.setItem("nearfm_outlayer_api_key", data.api_key);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="glass-card rounded-2xl p-6"><div className="h-4 skeleton rounded w-1/3" /></div>;
  }

  if (!apiKey) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <p className="text-slate-400 text-sm">
          No wallet found. Visit <a href="/balance" className="text-purple-400 hover:text-purple-300">/balance</a> to create one.
        </p>
      </div>
    );
  }

  const maskedKey = apiKey.slice(0, 6) + "•".repeat(20) + apiKey.slice(-4);
  const dashboardUrl = `https://outlayer.fastnear.com/wallet?key=${apiKey}`;

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div>
          <div className="text-sm font-medium text-slate-300 mb-1">OutLayer Custody Wallet</div>
          <p className="text-xs text-slate-400 mb-1">
            An OutLayer custody wallet has been created for you. Your key is stored in your browser, with a backup copy on the server.
          </p>
          <p className="text-xs text-slate-400 mb-3">
            Copy and save this key — you can use it to manage your funds independently, even if NEAR FM is unavailable.
          </p>
        </div>

        <div className="bg-black/20 rounded-xl p-4 space-y-3">
          <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Wallet Key</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-slate-300 font-mono break-all">
              {revealed ? apiKey : maskedKey}
            </code>
            <button
              onClick={() => setRevealed(!revealed)}
              className="px-3 py-1.5 text-xs text-slate-400 bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.08] transition shrink-0"
            >
              {revealed ? "Hide" : "Show"}
            </button>
          </div>
          {revealed && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(apiKey);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="text-xs text-purple-400 hover:text-purple-300 transition"
            >
              {copied ? "Copied!" : "Copy to clipboard"}
            </button>
          )}
        </div>

        {nearAccount && (
          <div className="text-xs text-slate-500">
            NEAR account: <span className="text-slate-400 font-mono">{nearAccount}</span>
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="text-sm font-medium text-slate-300">What you can do with this wallet</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
            <div className="text-xs font-medium text-cyan-400 mb-1">Gasless Transactions</div>
            <p className="text-[11px] text-slate-500">Send tips, create payment checks, and withdraw funds — no gas tokens needed on any chain.</p>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
            <div className="text-xs font-medium text-purple-400 mb-1">Cross-Chain Swaps</div>
            <p className="text-[11px] text-slate-500">Swap between 200+ tokens across NEAR, Solana, Ethereum, and 20+ other chains via NEAR Intents.</p>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
            <div className="text-xs font-medium text-green-400 mb-1">Payment Checks</div>
            <p className="text-[11px] text-slate-500">Create and claim payment checks — instant, gasless transfers between wallets on any chain.</p>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.04]">
            <div className="text-xs font-medium text-amber-400 mb-1">Withdraw Anywhere</div>
            <p className="text-[11px] text-slate-500">Send funds to your NEAR, Solana, Ethereum, Bitcoin wallet — or any of 20+ supported chains.</p>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-3">
        <div className="text-sm font-medium text-slate-300">Use independently</div>
        <p className="text-xs text-slate-400">
          Your balance is stored on-chain (intents.near). NEAR FM does not hold your funds — you always have full control.
        </p>
        <p className="text-xs text-slate-500">
          Give an AI agent the wallet skill so it can manage your NEAR FM wallet — send tips, check balance, and more.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="https://skills.outlayer.ai/agent-custody/SKILL.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-400 bg-purple-500/10 border border-purple-500/20 rounded-lg hover:bg-purple-500/15 transition"
          >
            Agent Wallet Skill
          </a>
          <a
            href="https://outlayer.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 bg-white/[0.04] border border-white/[0.06] rounded-lg hover:bg-white/[0.08] transition"
          >
            About OutLayer
          </a>
        </div>
      </div>
    </div>
  );
}
