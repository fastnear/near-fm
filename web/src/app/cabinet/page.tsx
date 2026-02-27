"use client";

import { useEffect, useState, useCallback } from "react";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getUserProfile, getBookmarks, getNotifications, markAllNotificationsRead } from "@/lib/api";
import { depositAction, withdrawAction, getBalance } from "@/lib/near/contract";
import { SongCard } from "@/components/song/SongCard";
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

type TabKey = "balance" | "songs" | "bookmarks" | "notifications";

const TABS: { key: TabKey; label: string }[] = [
  { key: "balance", label: "Balance" },
  { key: "songs", label: "My Songs" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "notifications", label: "Notifications" },
];

// ── Main component ──

export default function CabinetPage() {
  const { accountId, isAuthenticated, signIn, callFunction, viewMethod, loading: walletLoading } = useNearWallet();
  const [activeTab, setActiveTab] = useState<TabKey>("balance");

  if (walletLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <div className="inline-block w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 mt-4">Loading wallet...</p>
      </div>
    );
  }

  if (!accountId || !isAuthenticated) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <div className="glass-card rounded-3xl p-12 max-w-md mx-auto">
          <div className="text-5xl mb-4 text-slate-700">&#128274;</div>
          <h1 className="text-xl font-bold text-white mb-2">Sign in</h1>
          <p className="text-slate-400 text-sm mb-6">
            Sign in to access your dashboard, manage your balance, and view your songs.
          </p>
          <button
            onClick={signIn}
            className="btn-primary px-6 py-3 rounded-xl"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <h1 className="text-2xl font-bold text-white mb-6">My Cabinet</h1>

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
      {activeTab === "songs" && <MySongsTab />}
      {activeTab === "bookmarks" && <BookmarksTab />}
      {activeTab === "notifications" && <NotificationsTab />}
    </div>
  );
}

// ── Balance Tab ──

function BalanceTab() {
  const { accountId, callFunction, viewMethod } = useNearWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("");
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
      await fetchBalance();
    } catch (e: any) {
      console.error("Withdraw failed:", e);
      setActionError(e.message || "Withdraw failed.");
    }
    setActionLoading(false);
  };

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
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl px-4 py-3 text-sm">
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
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              disabled={actionLoading}
              className="flex-1 border border-white/[0.08] bg-white/[0.04] rounded-xl px-4 py-3 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition disabled:opacity-50"
            />
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

function MySongsTab() {
  const { accountId } = useNearWallet();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    const load = async () => {
      setLoading(true);
      try {
        const data: any = await getUserProfile(accountId);
        setSongs(data.songs ?? []);
      } catch (e) {
        console.error("Failed to load songs:", e);
      }
      setLoading(false);
    };
    load();
  }, [accountId]);

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

function BookmarksTab() {
  const { accountId } = useNearWallet();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    const load = async () => {
      setLoading(true);
      try {
        const data = await getBookmarks(accountId);
        setSongs(data);
      } catch (e) {
        console.error("Failed to load bookmarks:", e);
      }
      setLoading(false);
    };
    load();
  }, [accountId]);

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
        <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
    case "bounty_awarded":
      return (
        <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      );
    case "submission_to_request":
      return (
        <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
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

function notificationText(notif: Notification): string {
  const data = notif.data;

  switch (notif.type) {
    case "tip_received": {
      const amount = data.amount_yocto as string | undefined;
      const from = data.from_account_id as string | undefined;
      const nearAmount = amount ? yoctoToNear(amount) : "?";
      return `You received a tip of ${nearAmount} NEAR${from ? ` from ${from}` : ""}`;
    }
    case "song_reported":
      return `Your song has been reported${data.reason ? `: ${data.reason}` : ""}`;
    case "song_hidden":
      return "Your song has been hidden by a moderator";
    case "bounty_awarded": {
      const bountyAmount = data.amount_yocto as string | undefined;
      const nearBounty = bountyAmount ? yoctoToNear(bountyAmount) : "?";
      return `You were awarded a bounty of ${nearBounty} NEAR`;
    }
    case "submission_to_request":
      return `A new song was submitted to your request${data.song_title ? `: "${data.song_title}"` : ""}`;
    default:
      return "You have a new notification";
  }
}

function NotificationsTab() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotifications();
      setNotifications(data);
    } catch (e) {
      console.error("Failed to load notifications:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    try {
      await markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true }))
      );
    } catch (e) {
      console.error("Failed to mark notifications read:", e);
    }
    setMarkingRead(false);
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

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
      {/* Header with mark all read */}
      {unreadCount > 0 && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-400">
            {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
          </p>
          <button
            onClick={handleMarkAllRead}
            disabled={markingRead}
            className="text-sm text-purple-400 hover:text-purple-300 transition disabled:opacity-50"
          >
            {markingRead ? "Marking..." : "Mark all read"}
          </button>
        </div>
      )}

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
