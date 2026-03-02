"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getNotifications } from "@/lib/api";
import { AnimatedLogo } from "@/components/AnimatedLogo";

function NavLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`relative text-sm text-slate-300 hover:text-white transition-colors duration-200 after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[2px] after:bg-gradient-to-r after:from-purple-500 after:to-cyan-500 after:transition-all after:duration-300 hover:after:w-full ${className}`}
    >
      {children}
    </Link>
  );
}

export function Header() {
  const { accountId, signIn, signOut, isAuthenticated, loading } = useNearWallet();
  const [unreadCount, setUnreadCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const showBack = pathname !== "/" && pathname !== "/trending" && pathname !== "/latest" && pathname !== "/top";
  const base = "";

  useEffect(() => {
    if (!accountId || !isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    getNotifications()
      .then((notifs) => {
        setUnreadCount(notifs.filter((n) => !n.is_read).length);
      })
      .catch(() => {});
  }, [accountId, isAuthenticated]);

  const navLinkClass = "relative text-sm text-slate-300 hover:text-white transition-colors duration-200 after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[2px] after:bg-gradient-to-r after:from-purple-500 after:to-cyan-500 after:transition-all after:duration-300 hover:after:w-full";

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
          <a href={`${base}/`} className="flex items-center gap-2.5 group">
            <AnimatedLogo className="w-10 h-10" variant="header" />
            <span className="text-xl font-bold text-gradient">
              near.fm
            </span>
          </a>
        </div>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-8">
          <a href={`${base}/`} className={navLinkClass}>Feed</a>
          <a href={`${base}/requests`} className={navLinkClass}>Requests</a>
          <a href={`${base}/upload`} className={navLinkClass}>Upload</a>
          <a href={`${base}/about`} className={navLinkClass}>About</a>
          <a href={`${base}/cabinet`} className={navLinkClass}>
            Cabinet
            {unreadCount > 0 && (
              <span className="absolute -top-2.5 -right-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-lg shadow-purple-500/30 animate-pulse">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </a>
        </nav>

        {/* Wallet */}
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-28 h-9 rounded-xl skeleton" />
          ) : accountId ? (
            <Link
              href={`/profile/${accountId}`}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all truncate max-w-[160px]"
            >
              {accountId}
            </Link>
          ) : (
            <button
              onClick={signIn}
              className="btn-primary px-5 py-2 text-sm rounded-xl"
            >
              Sign in
            </button>
          )}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden flex items-center justify-around border-t border-white/[0.06] py-2.5 text-xs">
        <a href={`${base}/`} className="text-slate-400 hover:text-white transition-colors py-1">
          Feed
        </a>
        <a href={`${base}/requests`} className="text-slate-400 hover:text-white transition-colors py-1">
          Requests
        </a>
        <a href={`${base}/upload`} className="text-slate-400 hover:text-white transition-colors py-1">
          Upload
        </a>
        <a href={`${base}/about`} className="text-slate-400 hover:text-white transition-colors py-1">
          About
        </a>
        <a href={`${base}/cabinet`} className="relative text-slate-400 hover:text-white transition-colors py-1">
          Cabinet
          {unreadCount > 0 && (
            <span className="absolute -top-2 -right-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 shadow-lg shadow-purple-500/30">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </a>
      </nav>
    </header>
  );
}
