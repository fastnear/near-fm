"use client";

import { useState } from "react";
import type { Song } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { attachSongCoin, lookupCoin, type SongCoin, type TokenInfo } from "@/lib/api";
import { CoinLaunchModal } from "./CoinLaunchModal";

const SOURCE_LABEL: Record<string, string> = { "nearly.trade": "nearly.trade", "justhoot.fun": "JustHoot", external: "another launchpad / DEX" };

function fmtSupply(raw: string | null, decimals: number): string {
  if (!raw) return "—";
  const whole = raw.length > decimals ? raw.slice(0, raw.length - decimals) : "0";
  const n = Number(whole);
  if (!Number.isFinite(n)) return whole;
  return n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString("en-US");
}

/** One modal for the author: link an existing coin the song is about, or launch a new one from it. */
export function CoinModal({ song, onClose, onDone }: { song: Song; onClose: () => void; onDone: (coin: SongCoin) => void }) {
  const { user } = useAuth();
  const { accountId } = useNearWallet();
  const canLaunch = user?.auth_provider === "near" && !!accountId && accountId === user?.near_account_id;
  const [tab, setTab] = useState<"link" | "create">("link");

  // Link tab
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [tradeUrl, setTradeUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    setBusy("Looking up the token…");
    setError(null);
    setInfo(null);
    try {
      const t = await lookupCoin(query);
      setInfo(t);
      setTradeUrl(t.trade_url ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Token not found");
    }
    setBusy(null);
  };

  const attach = async () => {
    if (!info) return;
    setBusy("Checking that the song is about this coin…");
    setError(null);
    try {
      const coin = await attachSongCoin(song.uuid, info.token_account, tradeUrl.trim() || undefined);
      onDone(coin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link the coin");
    }
    setBusy(null);
  };

  const field = "w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-purple-500/50";
  const tabBtn = (active: boolean) =>
    `flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${active ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-slate-200"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-[#0f0f14] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-white">Memecoin for this song</h2>
          <button onClick={onClose} disabled={!!busy} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] mb-5">
          <button type="button" className={tabBtn(tab === "link")} onClick={() => setTab("link")}>Link an existing coin</button>
          <button type="button" className={tabBtn(tab === "create")} onClick={() => setTab("create")}>Create a new coin</button>
        </div>

        {tab === "link" ? (
          <>
            <p className="text-xs text-slate-500 mb-4">
              Is this song about a memecoin that already exists? Link it. The song&apos;s words are checked to be about the coin — a generic track won&apos;t pass.
            </p>
            <label className="block text-xs font-medium text-slate-400 mb-1">Token contract or link</label>
            <div className="flex gap-2 mb-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="coin.nearlytrade.near or https://nearly.trade/…" className={field}
                onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) lookup(); }} />
              <button type="button" onClick={lookup} disabled={!query.trim() || !!busy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.06] border border-white/[0.08] text-slate-200 hover:bg-white/[0.1] disabled:opacity-40 whitespace-nowrap">
                Look up
              </button>
            </div>
            <p className="text-[11px] text-slate-600 mb-4">Any NEP-141 token on NEAR: from nearly.trade, JustHoot, Ref or anywhere else.</p>

            {info && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 mb-4">
                <div className="flex items-center gap-3">
                  {info.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={info.icon} alt="" className="w-12 h-12 rounded-xl object-cover bg-black/30" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-white/[0.06] flex items-center justify-center text-slate-500 text-xs">{info.symbol.slice(0, 3)}</div>
                  )}
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{info.name} <span className="text-slate-400 font-normal">${info.symbol}</span></div>
                    <div className="text-xs text-slate-500 truncate">{info.token_account}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs text-slate-400">
                  <span>Supply: <span className="text-slate-200">{fmtSupply(info.total_supply, info.decimals)}</span></span>
                  <span>From: <span className="text-slate-200">{SOURCE_LABEL[info.source] ?? info.source}</span></span>
                  {info.creator && <span className="col-span-2 truncate">Creator: <span className="text-slate-200">{info.creator}</span></span>}
                </div>

                <label className="block text-xs font-medium text-slate-400 mt-4 mb-1">Trade link {info.trade_url ? <span className="text-slate-600">detected — change it if you like</span> : <span className="text-amber-300/80">required — we couldn&apos;t find where it&apos;s traded</span>}</label>
                <input value={tradeUrl} onChange={(e) => setTradeUrl(e.target.value)} placeholder="https://…" className={field} />
                <p className="text-[11px] text-slate-600 mt-1.5">Where the &quot;Trade&quot; button on the song page sends people. Links to sites we don&apos;t know get a &quot;leaving near.fm&quot; warning.</p>
              </div>
            )}

            {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

            <button type="button" onClick={attach} disabled={!info || !tradeUrl.trim() || !!busy}
              className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-500 to-purple-500 disabled:opacity-40 transition">
              {busy ?? (info ? `Link $${info.symbol} to this song` : "Look up a token first")}
            </button>
            <p className="text-[11px] text-slate-600 mt-3">near.fm does not review, endorse or trade any coin. Linking only tells listeners what the song is about.</p>
          </>
        ) : canLaunch ? (
          <CoinLaunchModal song={song} onLaunched={onDone} />
        ) : (
          <p className="text-sm text-slate-400 py-6 text-center">
            Launching a new coin is paid in NEAR and signed in your wallet — sign in with a NEAR wallet to use it.
          </p>
        )}
      </div>
    </div>
  );
}
