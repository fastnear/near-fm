"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useSolanaWallet } from "@/contexts/SolanaWalletContext";
import { useEthWallet } from "@/contexts/EthWalletContext";

export function SignInModal() {
  const { showSignInModal, closeSignInModal, signInWithGoogle } = useAuth();
  const { connectAndSignIn } = useNearWallet();
  const { connectAndSignIn: connectSolana } = useSolanaWallet();
  const { connectAndSignIn: connectEth } = useEthWallet();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSignInModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSignInModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSignInModal, closeSignInModal]);

  if (!showSignInModal) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) closeSignInModal(); }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm mx-4 rounded-2xl border border-white/[0.1] shadow-2xl p-6 bg-slate-900/95 backdrop-blur-xl">
        <h2 className="text-lg font-semibold text-white mb-2">Sign in to AI RADIO</h2>
        <ul className="text-sm text-slate-400 mb-6 space-y-1.5">
          <li className="flex items-center gap-2"><span className="text-purple-400">&#x2022;</span> Vote and comment on songs</li>
          <li className="flex items-center gap-2"><span className="text-purple-400">&#x2022;</span> Follow your favorite artists</li>
          <li className="flex items-center gap-2"><span className="text-purple-400">&#x2022;</span> Customize your feed</li>
          <li className="flex items-center gap-2"><span className="text-purple-400">&#x2022;</span> Block unwanted authors</li>
        </ul>

        <div className="space-y-3">
          {/* Google */}
          <button
            onClick={() => {
              closeSignInModal();
              signInWithGoogle();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.1] transition-all"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>

          {/* Ethereum */}
          <button
            onClick={() => {
              closeSignInModal();
              connectEth();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.1] transition-all"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 784 784" fill="none">
              <path d="M392 0L387.5 15.3V536.2L392 540.7L633.6 398.2L392 0Z" fill="#343434"/>
              <path d="M392 0L150.4 398.2L392 540.7V289.6V0Z" fill="#8C8C8C"/>
              <path d="M392 586.4L389.5 589.4V779.3L392 784L633.8 444L392 586.4Z" fill="#3C3C3C"/>
              <path d="M392 784V586.4L150.4 444L392 784Z" fill="#8C8C8C"/>
              <path d="M392 540.7L633.6 398.2L392 289.6V540.7Z" fill="#141414"/>
              <path d="M150.4 398.2L392 540.7V289.6L150.4 398.2Z" fill="#393939"/>
            </svg>
            Sign in with Ethereum
          </button>

          {/* NEAR */}
          <button
            onClick={() => {
              closeSignInModal();
              connectAndSignIn();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.1] transition-all"
          >
            <svg className="w-5 h-5 shrink-0 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
            </svg>
            Sign in with NEAR
          </button>

          {/* Solana */}
          <button
            onClick={() => {
              closeSignInModal();
              connectSolana();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.1] transition-all"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 397.7 311.7" fill="none">
              <linearGradient id="sol-a" x1="360.9" y1="351.5" x2="141.2" y2="-69.2" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 -25)">
                <stop offset="0" stopColor="#00FFA3" />
                <stop offset="1" stopColor="#DC1FFF" />
              </linearGradient>
              <path fill="url(#sol-a)" d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
              <path fill="url(#sol-a)" d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
              <path fill="url(#sol-a)" d="M333.1 120c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1L333.1 120z" />
            </svg>
            Sign in with Solana
          </button>
        </div>

        <button
          onClick={closeSignInModal}
          className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-400 transition-colors py-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
