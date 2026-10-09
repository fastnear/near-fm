"use client";

import { useEffect, useState } from "react";
import type { Song } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { getSongCoins, type SongCoin } from "@/lib/api";
import { getLaunchpad } from "@/lib/launchpads";
import { CoinLaunchModal } from "./CoinLaunchModal";

/**
 * "The author made a memecoin from this song" badge, plus the launch button
 * for the author (NEAR wallet sign-in only — the launch is paid in NEAR).
 */
export function SongCoins({ song }: { song: Song }) {
  const { user } = useAuth();
  const { accountId } = useNearWallet();
  const [coins, setCoins] = useState<SongCoin[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getSongCoins(song.uuid).then(setCoins).catch(() => setCoins([]));
  }, [song.uuid]);

  const isAuthor = user?.id === song.uploader_id;
  // The launch is signed by the connected wallet, which must be the account the song belongs to.
  const canLaunch = isAuthor && user?.auth_provider === "near" && !!accountId && accountId === user?.near_account_id;
  const visible = coins.filter((c) => c.status !== "hidden");

  const hiddenOwn = isAuthor ? coins.filter((c) => c.status === "hidden") : [];

  if (visible.length === 0 && hiddenOwn.length === 0 && !canLaunch) return null;

  return (
    <div className="mt-5">
      {visible.map((coin) => {
        const lp = getLaunchpad(coin.launchpad);
        const href = lp ? lp.tokenUrl(coin.token_account) : "#";
        return (
          <a
            key={`${coin.launchpad}:${coin.token_account}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] hover:bg-amber-400/[0.1] px-4 py-3 transition"
          >
            <span className="text-xl">🚀</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-amber-100">
                The author made a memecoin from this song: <span className="font-semibold">${coin.symbol}</span>
                {coin.status === "pending" && <span className="text-amber-300/70"> · launching…</span>}
              </span>
              <span className="block text-xs text-amber-200/60 truncate">
                {coin.name} · {coin.token_account}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-200 shrink-0">
              {lp && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lp.logo} alt="" className="w-4 h-4 rounded" />
              )}
              Trade ↗
            </span>
          </a>
        );
      })}

      {hiddenOwn.map((coin) => (
        <p key={coin.token_account} className="text-xs text-slate-500 mb-2">
          Your coin ${coin.symbol} ({coin.token_account}) was launched but isn&apos;t shown here: it didn&apos;t look related to this song.
        </p>
      ))}

      {canLaunch && coins.length === 0 && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-amber-500/20 to-purple-500/20 border border-amber-400/30 text-amber-100 hover:from-amber-500/30 hover:to-purple-500/30 transition"
        >
          <span>🐸</span> Create a memecoin from this song
        </button>
      )}

      {open && (
        <CoinLaunchModal
          song={song}
          onClose={() => setOpen(false)}
          onLaunched={(coin) => { setCoins((c) => [...c, coin]); setOpen(false); }}
        />
      )}
    </div>
  );
}
