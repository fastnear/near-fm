"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getNotifications } from "@/lib/api";

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
  const [isUpload, setIsUpload] = useState(false);

  useEffect(() => {
    setIsUpload(window.location.hostname.startsWith("upload."));
  }, []);

  const base = isUpload ? "https://near.fm" : "";

  useEffect(() => {
    if (isUpload || !accountId || !isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    getNotifications()
      .then((notifs) => {
        setUnreadCount(notifs.filter((n) => !n.is_read).length);
      })
      .catch(() => {});
  }, [accountId, isAuthenticated, isUpload]);

  const navLinkClass = "relative text-sm text-slate-300 hover:text-white transition-colors duration-200 after:absolute after:bottom-0 after:left-0 after:w-0 after:h-[2px] after:bg-gradient-to-r after:from-purple-500 after:to-cyan-500 after:transition-all after:duration-300 hover:after:w-full";

  return (
    <header className="sticky top-0 z-50 glass-strong">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href={`${base}/`} className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-shadow">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <span className="text-xl font-bold text-gradient">
            near.fm
          </span>
        </a>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-8">
          <a href={`${base}/`} className={navLinkClass}>Feed</a>
          <a href={`${base}/requests`} className={navLinkClass}>Requests</a>
          <a href="https://upload.near.fm/" className={navLinkClass}>Upload</a>
          <a href={`${base}/cabinet`} className={navLinkClass}>
            Cabinet
            {!isUpload && unreadCount > 0 && (
              <span className="absolute -top-2.5 -right-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-lg shadow-purple-500/30 animate-pulse">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </a>
        </nav>

        {/* Wallet */}
        <div className="flex items-center gap-3">
          {!isUpload && (
            <>
              {loading ? (
                <div className="w-28 h-9 rounded-xl skeleton" />
              ) : accountId ? (
                <div className="flex items-center gap-3">
                  <Link
                    href={`/profile/${accountId}`}
                    className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-all truncate max-w-[160px]"
                  >
                    {accountId}
                  </Link>
                  <button
                    onClick={signOut}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  onClick={signIn}
                  className="btn-primary px-5 py-2 text-sm rounded-xl"
                >
                  Sign in
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden flex items-center justify-around border-t border-white/[0.06] py-2.5 text-xs">
        <a href={`${base}/`} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
          Feed
        </a>
        <a href={`${base}/requests`} className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          Requests
        </a>
        <a href="https://upload.near.fm/" className="flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
          <div className="w-8 h-8 -mt-4 rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          Upload
        </a>
        <a href={`${base}/cabinet`} className="relative flex flex-col items-center gap-1 text-slate-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
          Cabinet
          {!isUpload && unreadCount > 0 && (
            <span className="absolute -top-1 right-0 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 shadow-lg shadow-purple-500/30">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </a>
      </nav>
    </header>
  );
}
