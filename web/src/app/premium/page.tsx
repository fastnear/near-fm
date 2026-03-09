"use client";

import Link from "next/link";

export default function PremiumPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-lg w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold diamond-shimmer inline-block">
            NEAR FM Premium
          </h1>
          <p className="text-slate-400 text-lg">
            Exclusive features for music enthusiasts
          </p>
        </div>

        <div className="glass-card rounded-2xl p-6 space-y-4 text-left">
          <div className="flex items-start gap-3">
            <span className="text-cyan-400 text-xl mt-0.5">✦</span>
            <div>
              <div className="font-medium text-slate-200">Diamond Likes</div>
              <div className="text-sm text-slate-400">
                Highlight the best tracks with Diamond Likes — they carry more weight and boost songs to the top
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-cyan-400 text-xl mt-0.5">✦</span>
            <div>
              <div className="font-medium text-slate-200">Premium Badge</div>
              <div className="text-sm text-slate-400">
                Stand out with a premium badge on your profile
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-cyan-400 text-xl mt-0.5">✦</span>
            <div>
              <div className="font-medium text-slate-200">Playlists</div>
              <div className="text-sm text-slate-400">
                Create and manage playlists, export them to your phone
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-cyan-400 text-xl mt-0.5">✦</span>
            <div>
              <div className="font-medium text-slate-200">Early Access</div>
              <div className="text-sm text-slate-400">
                Be the first to try new platform features
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <button
            disabled
            className="w-full py-3 px-6 rounded-xl text-lg font-medium bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed"
          >
            Coming soon
          </button>
          <Link
            href="/"
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors inline-block"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
