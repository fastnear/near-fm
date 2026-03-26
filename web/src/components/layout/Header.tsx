"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getNotifications } from "@/lib/api";


export function Header() {
  const { user, isAuthenticated, isPremium, loading: authLoading, promptSignIn } = useAuth();
  const { accountId, connectAndSignIn, completeSignIn, signInPending, disconnectWallet, reconnectWallet, lowAllowance, loading: walletLoading } = useNearWallet();
  const [unreadCount, setUnreadCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const showBack = pathname !== "/" && pathname !== "/trending" && pathname !== "/latest" && pathname !== "/top";

  const loading = authLoading || walletLoading;

  useEffect(() => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    getNotifications()
      .then((notifs) => {
        setUnreadCount(notifs.filter((n) => !n.is_read).length);
      })
      .catch(() => {});

    // Listen for "notifications read" event from cabinet page
    const handleRead = () => setUnreadCount(0);
    window.addEventListener("nearfm_notifications_read", handleRead);
    return () => window.removeEventListener("nearfm_notifications_read", handleRead);
  }, [isAuthenticated]);

  const displayName = user?.display_name || user?.slug || "";
  const profileSlug = user?.slug || "";

  const navLink = (href: string, extra?: string) => {
    const isActive = href === "/"
      ? pathname === "/" || pathname === "/trending" || pathname === "/latest" || pathname === "/top" || pathname === "/following"
      : pathname.startsWith(href);
    return `relative text-sm transition-colors duration-200 after:absolute after:bottom-0 after:left-0 after:h-[2px] after:bg-gradient-to-r after:from-purple-500 after:to-cyan-500 after:transition-all after:duration-300 ${
      isActive
        ? "text-white after:w-full"
        : "text-slate-300 hover:text-white after:w-0 hover:after:w-full"
    } ${extra || ""}`;
  };

  return (
    <header className="sticky top-0 z-50 glass-strong">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Back + Logo */}
        <div className="flex items-center gap-1">
          {showBack && (
            <button
              onClick={() => router.back()}
              className="md:hidden p-1.5 -ml-1.5 text-slate-400 hover:text-white transition-colors"
              aria-label="Back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="text-xl font-bold text-gradient tracking-tight">
              NEAR FM
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-8" onClick={() => { try { localStorage.setItem("nearfm_visited", "1"); window.dispatchEvent(new Event("nearfm_dismiss_landing")); } catch {} }}>
          <Link href="/" className={navLink("/")}>Feed</Link>
          <Link href="/requests" className={navLink("/requests")}>Requests</Link>
          <Link href="/create" className={navLink("/create")}>Create</Link>
          <Link href="/upload" className={navLink("/upload")}>Upload</Link>
          <Link href="/balance" className={navLink("/balance")}>Balance</Link>
          <Link href="/premium" className={navLink("/premium", pathname === "/premium" ? "" : "diamond-shimmer")}>Premium</Link>
          <Link href="/cabinet" className={navLink("/cabinet")}>
            Cabinet
            {unreadCount > 0 && (
              <span className="absolute -top-2.5 -right-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-lg shadow-purple-500/30 animate-pulse">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
        </nav>

        {/* Auth */}
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-28 h-9 rounded-xl skeleton" />
          ) : signInPending && accountId && !isAuthenticated ? (
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  await completeSignIn();
                }}
                className="btn-primary px-4 py-2 text-sm rounded-xl"
              >
                Complete Sign-In
              </button>
              <button
                onClick={() => disconnectWallet()}
                className="p-2 text-slate-500 hover:text-slate-300 transition-colors"
                title="Cancel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : isAuthenticated && user ? (
            <Link
              href={`/profile/${profileSlug}`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all max-w-[200px]"
            >
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="truncate">{displayName}</span>
            </Link>
          ) : (
            <button
              onClick={promptSignIn}
              className="btn-primary px-5 py-2 text-sm rounded-xl"
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Ban banner */}
      {user?.is_banned && (
        <div className="bg-red-900/40 border-b border-red-500/20 px-4 py-2 text-center text-sm text-red-300">
          Your account has been suspended. You cannot upload, comment, vote, or tip.
        </div>
      )}

      {/* Low allowance warning */}
      {lowAllowance && isAuthenticated && (
        <div className="bg-amber-900/40 border-b border-amber-500/20 px-4 py-2 text-center text-sm text-amber-300">
          Your session key is running low on gas.{" "}
          <button onClick={reconnectWallet} className="underline underline-offset-2 font-medium hover:text-amber-200 transition">
            Reconnect wallet
          </button>
          {" "}to continue uploading and tipping.
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="md:hidden flex items-center justify-around border-t border-white/[0.06] py-1.5" onClick={() => { try { localStorage.setItem("nearfm_visited", "1"); window.dispatchEvent(new Event("nearfm_dismiss_landing")); } catch {} }}>
        <Link href="/" className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${pathname === "/" || pathname === "/trending" || pathname === "/latest" || pathname === "/top" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955a1.126 1.126 0 0 1 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
          <span className="text-[10px]">Feed</span>
        </Link>
        <Link href="/requests" className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${pathname === "/requests" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
          </svg>
          <span className="text-[10px]">Requests</span>
        </Link>
        <Link href="/upload" className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${pathname === "/upload" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <span className="text-[10px]">Upload</span>
        </Link>
        {isPremium || user?.is_admin ? (
          <Link href="/create" className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${pathname === "/create" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
            </svg>
            <span className="text-[10px]">Create</span>
          </Link>
        ) : (
          <Link href="/premium" className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${pathname === "/premium" ? "text-white" : "text-slate-500 hover:text-slate-300 diamond-shimmer"}`}>
            <span className="text-lg leading-5">✦</span>
            <span className="text-[10px]">Premium</span>
          </Link>
        )}
        <Link href="/cabinet" className={`relative flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${pathname === "/cabinet" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
          <span className="text-[10px]">Cabinet</span>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 right-0 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
      </nav>
    </header>
  );
}
