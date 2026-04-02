"use client";

import { useToast } from "./Toast";

export function ShareButton({ url, title }: { url: string; title?: string }) {
  const { showToast } = useToast();

  const handleShare = async () => {
    const fullUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ url: fullUrl, title: title || "near.fm" });
      } catch {
        // User cancelled — ignore
      }
    } else {
      try {
        await navigator.clipboard.writeText(fullUrl);
        showToast({ message: "Link copied!", type: "success", id: "share", duration: 2000 });
      } catch {
        showToast({ message: "Could not copy link", type: "error", id: "share", duration: 2000 });
      }
    }
  };

  return (
    <button
      onClick={handleShare}
      className="text-[11px] text-slate-600 hover:text-slate-300 transition-colors shrink-0"
      title="Share"
    >
      <svg className="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
      </svg>
    </button>
  );
}
