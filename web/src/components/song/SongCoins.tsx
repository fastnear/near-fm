"use client";

import { useEffect, useState } from "react";
import type { Song } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { detachSongCoin, getSongCoins, setSongCoinTradeUrl, type SongCoin } from "@/lib/api";
import { getLaunchpad } from "@/lib/launchpads";
import { CoinModal } from "./CoinModal";

/**
 * The song's memecoin: "the author made a memecoin from this song" or "this
 * song is about $X", with a trade link; plus the author's button to add one.
 */
export function SongCoins({ song }: { song: Song }) {
  const { user } = useAuth();
  const [coins, setCoins] = useState<SongCoin[]>([]);
  const [open, setOpen] = useState(false);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");

  useEffect(() => {
    getSongCoins(song.uuid).then(setCoins).catch(() => setCoins([]));
  }, [song.uuid]);

  const isAuthor = user?.id === song.uploader_id;
  const visible = coins.filter((c) => c.status !== "hidden");
  const hiddenOwn = isAuthor ? coins.filter((c) => c.status === "hidden") : [];

  if (visible.length === 0 && hiddenOwn.length === 0 && !isAuthor) return null;

  const openTrade = (coin: SongCoin) => {
    if (!coin.trade_url) return;
    if (!coin.trade_url_trusted) {
      const ok = window.confirm(
        `This link leads to an external site set by the song's author:\n${coin.trade_url}\n\nnear.fm does not know this site. Beware of scams — never enter seed phrases, and check the token account (${coin.token_account}) before trading.`,
      );
      if (!ok) return;
    }
    window.open(coin.trade_url, "_blank", "noopener,noreferrer");
  };

  const unlink = async (coin: SongCoin) => {
    if (!window.confirm(`Unlink $${coin.symbol} from this song? The token itself is not affected.`)) return;
    try {
      await detachSongCoin(song.uuid, coin.token_account);
      setCoins((c) => c.filter((x) => x.token_account !== coin.token_account));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const saveUrl = async (coin: SongCoin) => {
    try {
      const updated = await setSongCoinTradeUrl(song.uuid, coin.token_account, urlDraft.trim());
      setCoins((c) => c.map((x) => (x.token_account === coin.token_account ? updated : x)));
      setEditingUrl(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="mt-5">
      {visible.map((coin) => {
        const lp = getLaunchpad(coin.launchpad);
        const launched = coin.kind === "launched";
        return (
          <div key={`${coin.launchpad}:${coin.token_account}`} className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
            <button type="button" onClick={() => openTrade(coin)} className="w-full flex items-center gap-3 text-left hover:opacity-90 transition">
              {coin.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coin.icon} alt="" className="w-9 h-9 rounded-lg object-cover bg-black/30 shrink-0" />
              ) : (
                <span className="text-xl">{launched ? "🚀" : "🪙"}</span>
              )}
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-amber-100">
                  {launched ? "The author made a memecoin from this song: " : "This song is about "}
                  <span className="font-semibold">${coin.symbol}</span>
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
                {coin.trade_url_trusted ? "Trade ↗" : "Trade ↗ (external site)"}
              </span>
            </button>

            {isAuthor && (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                {editingUrl === coin.token_account ? (
                  <span className="flex items-center gap-2 w-full">
                    <input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://…"
                      className="flex-1 px-2 py-1 rounded bg-white/[0.04] border border-white/[0.08] text-xs text-slate-200" />
                    <button type="button" onClick={() => saveUrl(coin)} className="text-purple-300 hover:text-purple-200">Save</button>
                    <button type="button" onClick={() => setEditingUrl(null)} className="hover:text-slate-300">Cancel</button>
                  </span>
                ) : (
                  <>
                    <button type="button" onClick={() => { setEditingUrl(coin.token_account); setUrlDraft(coin.trade_url ?? ""); }} className="hover:text-slate-300">Change trade link</button>
                    <button type="button" onClick={() => unlink(coin)} className="hover:text-red-300">Unlink</button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {hiddenOwn.map((coin) => (
        <p key={coin.token_account} className="text-xs text-slate-500 mb-2">
          Your coin ${coin.symbol} ({coin.token_account}) was launched but isn&apos;t shown here: it didn&apos;t look related to this song.
        </p>
      ))}

      {isAuthor && coins.length === 0 && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-amber-500/20 to-purple-500/20 border border-amber-400/30 text-amber-100 hover:from-amber-500/30 hover:to-purple-500/30 transition"
        >
          <span>🐸</span> Memecoin for this song
        </button>
      )}

      {open && (
        <CoinModal
          song={song}
          onClose={() => setOpen(false)}
          onDone={(coin) => { setCoins((c) => [...c, coin]); setOpen(false); }}
        />
      )}
    </div>
  );
}
