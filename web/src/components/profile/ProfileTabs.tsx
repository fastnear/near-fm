"use client";

export type ProfileTab = "songs" | "blog" | "feed" | "tips";

const tabs: { label: string; value: ProfileTab; href: (slug: string) => string; icon: string }[] = [
  { label: "Songs", value: "songs", href: (s) => `/profile/${s}/songs`, icon: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" },
  { label: "Blog", value: "blog", href: (s) => `/profile/${s}/blog`, icon: "M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" },
  { label: "Fan Feed", value: "feed", href: (s) => `/profile/${s}/feed`, icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
  { label: "Tips & Gifts", value: "tips", href: (s) => `/profile/${s}/tips`, icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
];

interface ProfileTabsProps {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  slug: string;
  badges?: Partial<Record<ProfileTab, number>>;
}

export function ProfileTabs({ activeTab, onTabChange, slug, badges }: ProfileTabsProps) {
  return (
    <div className="flex gap-1 glass rounded-2xl p-1 mb-6">
      {tabs.map((tab) => {
        const badge = badges?.[tab.value] ?? 0;
        return (
          <a
            key={tab.value}
            href={tab.href(slug)}
            onClick={(e) => {
              e.preventDefault();
              window.history.replaceState(null, "", tab.href(slug));
              onTabChange(tab.value);
            }}
            className={`flex items-center gap-1.5 px-2.5 sm:px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
              activeTab === tab.value
                ? "bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-white border border-purple-500/20 shadow-lg shadow-purple-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
            </svg>
            <span className="hidden sm:inline">{tab.label}</span>
            {badge > 0 && (
              <span className="min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold rounded-full bg-purple-500/30 text-purple-300 border border-purple-500/30">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
