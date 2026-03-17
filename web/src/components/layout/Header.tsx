"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getNotifications } from "@/lib/api";
import { AnimatedLogo } from "@/components/AnimatedLogo";


export function Header() {
  const { user, isAuthenticated, isPremium, loading: authLoading, signInWithGoogle } = useAuth();
  const { accountId, connectAndSignIn, completeSignIn, signInPending, disconnectWallet, reconnectWallet, lowAllowance, loading: walletLoading } = useNearWallet();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showLoginMenu, setShowLoginMenu] = useState(false);
  const loginMenuRef = useRef<HTMLDivElement>(null);
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

  // Close login menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (loginMenuRef.current && !loginMenuRef.current.contains(e.target as Node)) {
        setShowLoginMenu(false);
      }
    };
    if (showLoginMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showLoginMenu]);

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
            <AnimatedLogo className="w-10 h-10" variant="header" />
            <span className="text-xl font-bold text-gradient">
              near.fm
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-8" onClick={() => { try { localStorage.setItem("nearfm_visited", "1"); } catch {} }}>
          <Link href="/" className={navLink("/")}>Feed</Link>
          <Link href="/requests" className={navLink("/requests")}>Requests</Link>
          {(isPremium || user?.is_admin) && <Link href="/create" className={navLink("/create")}>Create</Link>}
          <Link href="/upload" className={navLink("/upload")}>Upload</Link>
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
            <div className="relative" ref={loginMenuRef}>
              <button
                onClick={() => setShowLoginMenu(!showLoginMenu)}
                className="btn-primary px-5 py-2 text-sm rounded-xl"
              >
                Sign in
              </button>
              {showLoginMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-slate-900 border border-white/[0.1] rounded-xl shadow-2xl overflow-hidden z-50">
                  <button
                    onClick={() => {
                      setShowLoginMenu(false);
                      signInWithGoogle();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-white/[0.06] transition-colors"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Sign in with Google
                  </button>
                  <div className="border-t border-white/[0.06]" />
                  <button
                    onClick={() => {
                      setShowLoginMenu(false);
                      connectAndSignIn();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-200 hover:bg-white/[0.06] transition-colors"
                  >
                    <svg className="w-5 h-5 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
                    </svg>
                    Sign in with NEAR
                  </button>
                </div>
              )}
            </div>
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
      <nav className="md:hidden flex items-center justify-around border-t border-white/[0.06] py-1.5" onClick={() => { try { localStorage.setItem("nearfm_visited", "1"); } catch {} }}>
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
        <Link href="/premium" className={`flex flex-col items-center gap-0.5 px-2 py-1 transition-colors ${pathname === "/premium" ? "text-white" : "text-slate-500 hover:text-slate-300 diamond-shimmer"}`}>
          <span className="text-lg leading-5">✦</span>
          <span className="text-[10px]">Premium</span>
        </Link>
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
