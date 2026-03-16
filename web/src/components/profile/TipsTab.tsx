"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSongTips, getPremiumGifts } from "@/lib/api";
import type { SongTipEntry, PremiumGiftEntry } from "@/lib/api";

function formatNear(yocto: string): string {
  const n = Number(yocto) / 1e24;
  if (n === 0) return "0";
  if (n >= 10 || n === Math.floor(n)) return Math.round(n).toString();
  if (n >= 0.1) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function truncateId(id: string, max = 30): string {
  if (id.length <= max) return id;
  return `${id.slice(0, 12)}...${id.slice(-8)}`;
}

export function TipsTab({ accountId }: { accountId: string }) {
  const [songTips, setSongTips] = useState<SongTipEntry[]>([]);
  const [premiumGifts, setPremiumGifts] = useState<PremiumGiftEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getSongTips(accountId).then(setSongTips),
      getPremiumGifts(accountId).then(setPremiumGifts),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accountId]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center animate-pulse">
            <div className="w-8 h-8 rounded-full skeleton" />
            <div className="h-4 skeleton rounded w-48" />
          </div>
        ))}
      </div>
    );
  }

  if (songTips.length === 0 && premiumGifts.length === 0) {
    return <p className="text-slate-500 text-sm py-8 text-center">No tips or gifts yet.</p>;
  }

  return (
    <div className="space-y-3">
      {premiumGifts.map((gift) => (
        <div key={`gift-${gift.id}`} className="flex gap-3 items-center">
          <Link href={`/profile/${gift.gifted_by_slug}`} className="shrink-0">
            {gift.gifted_by_avatar_url ? (
              <img src={gift.gifted_by_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-xs font-bold text-white">
                {(gift.gifted_by_display_name || gift.gifted_by_slug)?.[0]?.toUpperCase()}
              </div>
            )}
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-300">
              <Link href={`/profile/${gift.gifted_by_slug}`} className="font-medium text-white hover:underline">
                {gift.gifted_by_display_name || truncateId(gift.gifted_by_slug)}
              </Link>
              {" gifted "}
              <span className="text-cyan-400 font-medium diamond-shimmer">✦ {gift.days_added} days of Premium</span>
            </p>
          </div>
        </div>
      ))}
      {songTips.map((tip) => (
        <div key={tip.id} className="flex gap-3 items-center">
          <Link href={`/profile/${tip.tipper_slug}`} className="shrink-0">
            {tip.tipper_avatar_url ? (
              <img src={tip.tipper_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-cyan-600 flex items-center justify-center text-xs font-bold text-white">
                {(tip.tipper_display_name || tip.tipper_slug)?.[0]?.toUpperCase()}
              </div>
            )}
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-300">
              <Link href={`/profile/${tip.tipper_slug}`} className="font-medium text-white hover:underline">
                {tip.tipper_display_name || truncateId(tip.tipper_slug)}
              </Link>
              {" tipped "}
              <span className="text-cyan-400 font-medium">{formatNear(tip.amount_yocto)} NEAR</span>
              {" on "}
              <Link href={`/song/${tip.song_uuid}`} className="text-purple-400 hover:underline">
                {tip.song_title}
              </Link>
            </p>
          </div>
          {tip.song_cover_image_url && (
            <Link href={`/song/${tip.song_uuid}`} className="shrink-0">
              <img src={tip.song_cover_image_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
