"use client";

import { useEffect, useState } from "react";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import Link from "next/link";
import { getStats } from "@/lib/api";

function formatNear(yocto: string): string {
  const near = Number(yocto) / 1e24;
  return near.toFixed(2).replace(/\.00$/, "");
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AboutPage() {
  const [stats, setStats] = useState<{
    total_songs: number;
    total_plays: number;
    total_tips_yocto: string;
    total_bounties_yocto: string;
    total_tips_usd_cents: number;
    total_bounties_usd_cents: number;
  } | null>(null);

  useEffect(() => {
    getStats().then(setStats).catch(console.error);
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      {/* Hero */}
      <div className="flex flex-col items-center gap-4 mb-16">
        <AnimatedLogo className="h-[120px] w-auto" />
        <h1 className="text-5xl font-bold text-gradient tracking-tight">
          near.fm
        </h1>
        <p className="text-lg text-slate-400 text-center max-w-xl">
          Web3 platform for AI-generated music. Sign in with any wallet, tip artists, earn bounties &mdash; all gasless.
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <section className="mb-12">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="glass-card rounded-2xl p-5 text-center">
              <div className="text-2xl font-bold text-white">{stats.total_songs.toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-1">Tracks</div>
            </div>
            <div className="glass-card rounded-2xl p-5 text-center">
              <div className="text-2xl font-bold text-white">{stats.total_plays.toLocaleString()}</div>
              <div className="text-xs text-slate-500 mt-1">Total Plays</div>
            </div>
            <div className="glass-card rounded-2xl p-5 text-center">
              <div className="text-2xl font-bold text-purple-400">
                {stats.total_tips_usd_cents > 0 && <>{formatUsd(stats.total_tips_usd_cents)}</>}
                {stats.total_tips_usd_cents > 0 && Number(stats.total_tips_yocto) > 0 && " + "}
                {Number(stats.total_tips_yocto) > 0 && <>{formatNear(stats.total_tips_yocto)} N</>}
                {stats.total_tips_usd_cents === 0 && Number(stats.total_tips_yocto) === 0 && "$0"}
              </div>
              <div className="text-xs text-slate-500 mt-1">Tips Paid</div>
            </div>
            <div className="glass-card rounded-2xl p-5 text-center">
              <div className="text-2xl font-bold text-[#00ec97]">
                {stats.total_bounties_usd_cents > 0 && <>{formatUsd(stats.total_bounties_usd_cents)}</>}
                {stats.total_bounties_usd_cents > 0 && Number(stats.total_bounties_yocto) > 0 && " + "}
                {Number(stats.total_bounties_yocto) > 0 && <>{formatNear(stats.total_bounties_yocto)} N</>}
                {stats.total_bounties_usd_cents === 0 && Number(stats.total_bounties_yocto) === 0 && "$0"}
              </div>
              <div className="text-xs text-slate-500 mt-1">Bounties</div>
            </div>
          </div>
        </section>
      )}

      {/* What is near.fm */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-white mb-4">What is near.fm?</h2>
        <p className="text-slate-300 leading-relaxed">
          near.fm is a community-driven platform where creators share AI-generated music and listeners
          discover new sounds. Sign in with Google, NEAR, or Solana wallet. All financial operations &mdash;
          tips, bounties, premium &mdash; are gasless and denominated in USDC via OutLayer custody wallets.
        </p>
      </section>

      {/* Features */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-white mb-6">Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {
              title: "Listen & Discover",
              desc: "Browse a curated feed of AI-generated tracks sorted by trending, latest, or top-rated. Filter by genre, language, and category.",
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              ),
            },
            {
              title: "Tip Artists",
              desc: "Send USDC tips directly to creators. No gas fees, no wallet popups. Tips go 100% to the artist.",
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              ),
            },
            {
              title: "Song Requests & Bounties",
              desc: "Want a specific song? Post a request with a USD bounty. Creators compete to fulfill it and earn the reward.",
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              ),
            },
            {
              title: "Vote & Curate",
              desc: "Upvote and downvote tracks to surface the best music. Your votes shape the feed for everyone.",
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V2.75a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H3.5" />
              ),
            },
            {
              title: "Multi-Chain Wallet",
              desc: "Sign in with Google, NEAR, or Solana. Each user gets a gasless custody wallet. Deposit and withdraw USDC to any chain.",
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
              ),
            },
            {
              title: "Decentralized Storage",
              desc: "Audio files are stored on FastFS \u2014 a decentralized file system on NEAR. No single point of failure.",
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              ),
            },
            {
              title: "AI Music Generation",
              desc: "Generate songs with Suno V5.5 directly on the platform. Premium users get 40 free daily credits and video generation.",
              icon: (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              ),
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="glass-card rounded-2xl p-5"
            >
              <div className="w-10 h-10 rounded-xl bg-[#00ec97]/10 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-[#00ec97]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  {feature.icon}
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-white mb-1.5">{feature.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-white mb-4">How it works</h2>
        <ol className="space-y-3 text-slate-300 text-sm">
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">1</span>
            <span><strong className="text-white">Sign in</strong> &mdash; Use Google, NEAR wallet, or Solana wallet. A gasless custody wallet is created for you automatically.</span>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">2</span>
            <span><strong className="text-white">Create</strong> &mdash; Generate a track with Suno AI directly on the platform, or upload music created elsewhere.</span>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">3</span>
            <span><strong className="text-white">Earn</strong> &mdash; Listeners tip you in USDC. Fulfill bounty requests for bigger rewards.</span>
          </li>
          <li className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold shrink-0">4</span>
            <span><strong className="text-white">Withdraw</strong> &mdash; Send your balance to any NEAR or Solana wallet. Gasless.</span>
          </li>
        </ol>
      </section>

      {/* Fees */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-white mb-4">Fees</h2>
        <div className="glass-card rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>Tips</span>
            <span className="text-[#00ec97] font-medium">No fees</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Bounty awards</span>
            <span className="text-white font-medium">5%</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Deposits &amp; withdrawals</span>
            <span className="text-[#00ec97] font-medium">Free</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>All operations (tips, bounties, premium)</span>
            <span className="text-[#00ec97] font-medium">Gasless</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Voting, listening, bookmarks</span>
            <span className="text-[#00ec97] font-medium">Free</span>
          </div>
        </div>
      </section>

      {/* Tech */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-white mb-4">Web3-Powered</h2>
        <p className="text-slate-300 text-sm leading-relaxed mb-4">
          near.fm uses blockchain infrastructure for payments and storage. Each user gets an OutLayer
          custody wallet on NEAR Intents &mdash; gasless operations, multi-chain support.
          Audio files live on FastFS, a decentralized file system. Sign in with Google, NEAR, or Solana.
        </p>
        <p className="text-slate-400 text-sm">
          Created by <a href="https://fastnear.com" target="_blank" rel="noopener noreferrer" className="text-white hover:text-[#00ec97] transition-colors">FastNEAR</a>.
        </p>
      </section>

      {/* CTA */}
      <div className="text-center">
        <Link
          href="/"
          className="btn-primary px-8 py-3 rounded-xl text-sm font-medium inline-block"
        >
          Start Listening
        </Link>
      </div>
    </div>
  );
}
