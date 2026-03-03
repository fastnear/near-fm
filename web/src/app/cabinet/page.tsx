"use client";

import React from "react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getUserProfile, getBookmarks, getNotifications, markAllNotificationsRead, getReports, reviewReport, moderateSong } from "@/lib/api";
import { depositAction, withdrawAction, getBalance } from "@/lib/near/contract";
import { SongCard } from "@/components/song/SongCard";
import { BlockedUsers } from "@/components/cabinet/BlockedUsers";
import type { Song, Notification } from "@/types";

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

type TabKey = "balance" | "songs" | "bookmarks" | "feed" | "notifications" | "reports";

const BASE_TABS: { key: TabKey; label: string }[] = [
  { key: "balance", label: "Balance" },
  { key: "songs", label: "My Songs" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "feed", label: "Blocked Users" },
  { key: "notifications", label: "Notifications" },
];

const ADMIN_TABS: { key: TabKey; label: string }[] = [
  { key: "reports", label: "Reports" },
];

// ── Main component ──

export default function CabinetPage() {
  const { user, isAuthenticated, loading: authLoading, signInWithGoogle, signOut: authSignOut } = useAuth();
  const { accountId, connectAndSignIn, loading: walletLoading } = useNearWallet();
  const [activeTab, setActiveTab] = useState<TabKey>("balance");
  const isAdmin = user?.is_admin;
  const TABS = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  const userSlug = user?.slug;

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
      {activeTab === "bookmarks" && <BookmarksTab userSlug={userSlug} />}
      {activeTab === "feed" && <BlockedUsers />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "reports" && isAdmin && <ReportsTab />}
    </div>
  );
}

// ── Balance Tab ──

function BalanceTab() {
  const { user } = useAuth();
  const { accountId, connectWallet, linkWallet, callFunction, viewMethod } = useNearWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("1");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!accountId) return;
    try {
      const bal = await getBalance(
        viewMethod as (params: { contractId: string; method: string; args: Record<string, unknown> }) => Promise<string>,
        accountId
      );
      setBalance(typeof bal === "string" ? bal : String(bal));
    } catch (e) {
      console.error("Failed to fetch balance:", e);
      setBalance("0");
    }
    setLoading(false);
  }, [accountId, viewMethod]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const yocto = nearToYocto(depositAmount);
      const action = depositAction(yocto);
      await callFunction({
        contractId: action.contractId,
        method: action.method,
        args: action.args,
        gas: action.gas,
        deposit: action.deposit,
      });
      setDepositAmount("");
      setActionSuccess(`Deposited ${depositAmount} NEAR successfully.`);
      // Wait for NEAR finality before refreshing balance
      await new Promise((r) => setTimeout(r, 2000));
      await fetchBalance();
    } catch (e: any) {
      console.error("Deposit failed:", e);
      setActionError(e.message || "Deposit failed.");
    }
    setActionLoading(false);
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const yocto = nearToYocto(withdrawAmount);
      const action = withdrawAction(yocto);
      await callFunction({
        contractId: action.contractId,
        method: action.method,
        args: action.args,
        gas: action.gas,
      });
      setWithdrawAmount("");
      setActionSuccess(`Withdrew ${withdrawAmount} NEAR successfully.`);
      // Wait for NEAR finality before refreshing balance
      await new Promise((r) => setTimeout(r, 2000));
      await fetchBalance();
    } catch (e: any) {
      console.error("Withdraw failed:", e);
      setActionError(e.message || "Withdraw failed.");
    }
    setActionLoading(false);
  };

  // Wallet-selector not connected — show connect button
  if (!accountId) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center">
        <p className="text-slate-400 text-sm mb-4">Connect a NEAR wallet to manage your balance, send tips, and upload songs.</p>
        <button
          onClick={() => user?.near_account_id ? connectWallet() : linkWallet()}
          className="btn-primary px-6 py-3 rounded-xl font-medium"
        >
          Connect NEAR Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current balance */}
      <div className="glass-card rounded-2xl p-8 glow-purple text-center">
        <p className="text-slate-400 text-sm mb-2">Virtual Balance</p>
        {loading ? (
          <div className="h-10 rounded-xl w-40 mx-auto skeleton" />
        ) : (
          <p className="text-4xl font-bold text-white">
            {yoctoToNear(balance || "0")}{" "}
            <span className="text-lg text-slate-400 font-normal">NEAR</span>
          </p>
        )}
      </div>

      {/* Feedback messages */}
      {actionError && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl px-4 py-3 text-sm">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="bg-[#00ec97]/10 border border-[#00ec97]/20 text-[#00ec97] rounded-xl px-4 py-3 text-sm">
          {actionSuccess}
        </div>
      )}

      {/* Deposit & Withdraw */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Deposit */}
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-white font-semibold mb-4">Deposit NEAR</h3>
          <div className="flex gap-3">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              disabled={actionLoading}
              className="flex-1 border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition disabled:opacity-50"
            />
            <button
              onClick={handleDeposit}
              disabled={actionLoading || !depositAmount || parseFloat(depositAmount) <= 0}
              className="btn-primary rounded-xl disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none px-6 py-3"
            >
              {actionLoading ? "..." : "Deposit"}
            </button>
          </div>
        </div>

        {/* Withdraw */}
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-white font-semibold mb-4">Withdraw NEAR</h3>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={actionLoading}
                className="w-full border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 pr-14 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition disabled:opacity-50"
              />
              {balance && BigInt(balance) > 0 && (
                <button
                  type="button"
                  onClick={() => setWithdrawAmount(yoctoToNear(balance))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 rounded-lg transition"
                >
                  Max
                </button>
              )}
            </div>
            <button
              onClick={handleWithdraw}
              disabled={actionLoading || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
              className="btn-primary rounded-xl disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none px-6 py-3"
            >
              {actionLoading ? "..." : "Withdraw"}
            </button>
          </div>
        </div>
      </div>
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

// ── Bookmarks Tab ──

function BookmarksTab({ userSlug }: { userSlug?: string }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userSlug) return;
    const load = async () => {
      setLoading(true);
      try {
        const data = await getBookmarks(userSlug);
        setSongs(data);
      } catch (e) {
        console.error("Failed to load bookmarks:", e);
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
        <div className="text-5xl mb-4 text-slate-700">&#128278;</div>
        <p className="text-slate-400 text-lg">No bookmarks yet</p>
        <p className="text-slate-500 text-sm mt-2">
          Songs you bookmark will appear here.
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
      const amount = data.amount_yocto as string | undefined;
      const from = (data.from_account || data.from_account_id) as string | undefined;
      const nearAmount = amount ? yoctoToNear(amount) : "?";
      const songTitle = data.song_title as string | undefined;
      const songUuid = data.song_uuid as string | undefined;
      return (
        <>
          You received a tip of {nearAmount} NEAR
          {from ? <> from <Link href={`/profile/${from}`} className="text-purple-400 hover:underline">{from}</Link></> : ""}
          {songTitle && songUuid ? <> for <Link href={`/song/${songUuid}`} className="text-purple-400 hover:underline">&quot;{songTitle}&quot;</Link></> : ""}
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
    case "new_follower": {
      const followerSlug = data.follower_slug as string | undefined;
      return (
        <>
          <Link href={`/profile/${followerSlug}`} className="text-purple-400 hover:underline">{followerSlug}</Link>
          {" started following you"}
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

      // Auto-mark all as read
      if (data.some((n: Notification) => !n.is_read)) {
        markAllNotificationsRead().catch(() => {});
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
