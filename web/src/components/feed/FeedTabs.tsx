"use client";

import type { SortMode } from "@/types";

interface Props {
  activeSort: SortMode;
  onSortChange: (sort: SortMode) => void;
  isAuthenticated?: boolean;
}

const tabs: { label: string; value: SortMode; href: string; icon: string; authOnly?: boolean }[] = [
  { label: "Trending", value: "trending", href: "/trending", icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
  { label: "Latest", value: "latest", href: "/latest", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { label: "Top", value: "top", href: "/top", icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" },
  { label: "Following", value: "following", href: "/following", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", authOnly: true },
];

export function FeedTabs({ activeSort, onSortChange, isAuthenticated }: Props) {
  return (
    <div className="flex gap-1 glass rounded-2xl p-1">
      {tabs
        .filter((tab) => !tab.authOnly || isAuthenticated)
        .map((tab) => (
        <a
          key={tab.value}
          href={tab.href}
          onClick={(e) => {
            e.preventDefault();
            window.history.replaceState(null, "", tab.href);
            onSortChange(tab.value);
          }}
          className={`flex items-center gap-2 px-2.5 sm:px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
            activeSort === tab.value
              ? "bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-white border border-purple-500/20 shadow-lg shadow-purple-500/10"
              : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
          }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
          </svg>
          <span className="hidden sm:inline">{tab.label}</span>
        </a>
      ))}
    </div>
  );
}
