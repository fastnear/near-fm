"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Song } from "@/types";
import { useNearWallet } from "@/contexts/NearWalletContext";
import { useToast } from "@/components/ui/Toast";
import { checkSongCoin, dryRunSongCoin, linkSongCoin, suggestSongCoin, type SongCoin } from "@/lib/api";
import { LAUNCHPADS, type CostQuote, type FeeMode, type Launchpad, type LaunchpadConfig, type Tax, type TaxSplit } from "@/lib/launchpads";
import { compressIcon } from "@/lib/launchpads/image";

const fmtNear = (yocto: string, digits = 3) => (Number(BigInt(yocto) / BigInt("1000000000000000000")) / 1e6).toFixed(digits);

/** Title cut to 32 characters at a word boundary (the name can't be changed after launch). */
function suggestName(title: string): string {
  const t = title.trim();
  if (t.length <= 32) return t;
  const cut = t.slice(0, 32);
  const sp = cut.lastIndexOf(" ");
  return (sp > 12 ? cut.slice(0, sp) : cut).trim();
}

/** "Doom Slug (feat. X)" → "DOOMSLUG"; keeps 2–12 letters/digits. */
function suggestSymbol(title: string): string {
  const words = title.replace(/\(.*?\)|\[.*?\]/g, "").toUpperCase().match(/[A-Z0-9]+/g) || [];
  let s = words.join("");
  if (s.length > 12) s = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 12) : s.slice(0, 12);
  if (s.length > 12) s = s.slice(0, 12);
  return s.length >= 2 ? s : s.padEnd(2, "X");
}

function normalizeLink(kind: "website" | "twitter" | "telegram", raw: string, max: number): string | null {
  const v = raw.trim();
  if (!v) return null;
  let url = v;
  if (kind === "twitter" && /^@?[A-Za-z0-9_]{1,15}$/.test(v)) url = `https://x.com/${v.replace(/^@/, "")}`;
  if (kind === "telegram" && /^@?[A-Za-z0-9_]{3,32}$/.test(v)) url = `https://t.me/${v.replace(/^@/, "")}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString().slice(0, max);
  } catch {
    return null;
  }
}

const RPC = process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://rpc.mainnet.fastnear.com";

async function rpcQuery(params: Record<string, unknown>): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "q", method: "query", params }),
  });
  return r.json();
}

async function accountExists(accountId: string): Promise<boolean> {
  const j = await rpcQuery({ request_type: "view_account", finality: "final", account_id: accountId });
  return !!j.result && !j.error;
}

/** A human-readable failure from a wallet's signAndSendTransaction(s) result, or null if all succeeded. */
function txFailure(result: unknown): string | null {
  const outcomes = (Array.isArray(result) ? result : [result]) as Array<{ status?: { Failure?: unknown } } | null | undefined>;
  for (const o of outcomes) {
    const f = o?.status?.Failure;
    if (!f) continue;
    const s = JSON.stringify(f);
    const m = s.match(/"panic_msg":"([^"]+)"/) || s.match(/"ErrorMessage":"([^"]+)"/);
    return m ? m[1] : s.slice(0, 200);
  }
  return null;
}

interface Props {
  song: Song;
  onClose: () => void;
  onLaunched: (coin: SongCoin) => void;
}

export function CoinLaunchModal({ song, onClose, onLaunched }: Props) {
  const { accountId, viewMethod, callBatch } = useNearWallet();
  const { showToast } = useToast();
  const view = useCallback(
    (contractId: string, method: string, args: Record<string, unknown>) => viewMethod({ contractId, method, args }),
    [viewMethod],
  );

  const [launchpad, setLaunchpad] = useState<Launchpad>(LAUNCHPADS.find((l) => !l.comingSoon)!);
  const [config, setConfig] = useState<LaunchpadConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const songUrl = `https://near.fm/song/${song.uuid}`;
  const [name, setName] = useState(suggestName(song.title));
  const [symbol, setSymbol] = useState(suggestSymbol(song.title));
  const [description, setDescription] = useState(`Memecoin of the song "${song.title}" on near.fm — listen: ${songUrl}`.slice(0, 500));
  const [icon, setIcon] = useState<string | null>(null);
  const [iconState, setIconState] = useState<"loading" | "ready" | "failed" | "none">(song.cover_image_url ? "loading" : "none");
  const [website, setWebsite] = useState(songUrl);
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("creator");
  const [feeTo, setFeeTo] = useState("");
  const [buyTax, setBuyTax] = useState(0); // percent, 0-4
  const [sellTax, setSellTax] = useState(0);
  const [taxPreset, setTaxPreset] = useState(0);
  const [customSplit, setCustomSplit] = useState<TaxSplit | null>(null);
  const [pair, setPair] = useState<string | null>(null);
  const [devBuy, setDevBuy] = useState(""); // NEAR
  const [noLogoOk, setNoLogoOk] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [preview, setPreview] = useState<unknown[] | null>(null);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const s = await suggestSongCoin(song.uuid);
      setName(s.name);
      setSymbol(s.symbol);
      setDescription(`${s.description} Listen: ${songUrl}`.slice(0, 500));
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI is unavailable right now");
    }
    setSuggesting(false);
  };

  const [balanceYocto, setBalanceYocto] = useState<string | null>(null);
  const [quote, setQuote] = useState<CostQuote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Launchpad config (limits, pairs, first-buy cap)
  useEffect(() => {
    setConfig(null);
    setConfigError(null);
    if (launchpad.comingSoon) return;
    launchpad.loadConfig(view).then(setConfig).catch((e: unknown) => setConfigError(e instanceof Error ? e.message : "Launchpad unavailable"));
  }, [launchpad, view]);

  // Wallet balance
  useEffect(() => {
    if (!accountId) return;
    rpcQuery({ request_type: "view_account", finality: "final", account_id: accountId })
      .then((j) => setBalanceYocto((j.result?.amount as string | undefined) ?? null))
      .catch(() => setBalanceYocto(null));
  }, [accountId]);

  // Logo from the song cover, compressed to the launchpad's on-chain limit
  useEffect(() => {
    if (!song.cover_image_url || !config) return;
    let cancelled = false;
    setIconState("loading");
    compressIcon(song.cover_image_url, { hardCap: config.maxIconBytes - 64 })
      .then((r) => { if (!cancelled) { setIcon(r.dataUri); setIconState("ready"); } })
      .catch(() => { if (!cancelled) setIconState("failed"); });
    return () => { cancelled = true; };
  }, [song.cover_image_url, config]);

  const onPickIcon = async (file: File | undefined) => {
    if (!file || !config) return;
    setIconState("loading");
    try {
      const r = await compressIcon(file, { hardCap: config.maxIconBytes - 64 });
      setIcon(r.dataUri);
      setIconState("ready");
    } catch (e) {
      setIconState("failed");
      setError(e instanceof Error ? e.message : "Could not read that image");
    }
  };

  const symbolUpper = symbol.toUpperCase();
  const pairOption = config?.pairs.find((p) => p.tokenId === (pair ?? config.pairs.find((x) => x.native)?.tokenId));
  const isNativePair = pairOption?.native ?? true;
  const tax: Tax | null = useMemo(() => {
    if (buyTax === 0 && sellTax === 0) return null;
    const split = customSplit ?? launchpad.taxPresets[taxPreset]?.split ?? { creator_bps: 10000, burn_bps: 0, holders_bps: 0 };
    return { buy_bps: buyTax * 100, sell_bps: sellTax * 100, ...split };
  }, [buyTax, sellTax, customSplit, taxPreset, launchpad]);
  const devBuyYocto = useMemo(() => {
    if (!isNativePair) return null;
    const n = parseFloat(devBuy);
    if (!(n > 0)) return null;
    return (BigInt(Math.round(n * 1e6)) * BigInt("1000000000000000000")).toString();
  }, [devBuy, isNativePair]);

  const form = useMemo(() => ({
    name: name.trim(),
    symbol: symbolUpper,
    description,
    icon,
    links: {
      website: normalizeLink("website", website, launchpad.limits.linkMax),
      twitter: normalizeLink("twitter", twitter, launchpad.limits.linkMax),
      telegram: normalizeLink("telegram", telegram, launchpad.limits.linkMax),
    },
    feeMode,
    feeTo: feeMode === "other" ? feeTo.trim() || null : null,
    tax,
    pair: isNativePair ? null : pairOption?.tokenId ?? null,
    devBuyYocto,
  }), [name, symbolUpper, description, icon, website, twitter, telegram, launchpad, feeMode, feeTo, tax, isNativePair, pairOption, devBuyYocto]);

  const problems = useMemo(() => {
    const p: Record<string, string> = {};
    if (!form.name) p.name = "Give it a name";
    else if (form.name.length > launchpad.limits.nameMax) p.name = `Max ${launchpad.limits.nameMax} characters`;
    if (!launchpad.limits.symbolPattern.test(form.symbol)) p.symbol = launchpad.limits.symbolHint;
    if (description.length > launchpad.limits.descriptionMax) p.description = `Max ${launchpad.limits.descriptionMax} characters`;
    if (feeMode === "other" && !/^[a-z0-9._-]{2,64}$/.test(feeTo.trim())) p.feeTo = "Enter a NEAR account";
    if (tax && tax.creator_bps + tax.burn_bps + tax.holders_bps !== 10000) p.tax = "Tax split must total 100%";
    if (devBuyYocto && config && BigInt(devBuyYocto) > BigInt(config.devBuyCapYocto)) p.devBuy = `Max ${fmtNear(config.devBuyCapYocto, 1)} NEAR`;
    for (const k of ["website", "twitter", "telegram"] as const) {
      const raw = { website, twitter, telegram }[k];
      if (raw.trim() && !form.links[k]) p[k] = "Enter a valid link";
    }
    return p;
  }, [form, launchpad, description, feeMode, feeTo, tax, devBuyYocto, config, website, twitter, telegram]);
  const valid = Object.keys(problems).length === 0 && iconState !== "loading" && (!!icon || noLogoOk);

  // Cost quote
  useEffect(() => {
    if (!config || launchpad.comingSoon) return;
    const t = setTimeout(() => {
      launchpad.quoteCost(view, form).then(setQuote).catch(() => setQuote(null));
    }, 300);
    return () => clearTimeout(t);
  }, [config, launchpad, view, form]);

  const gasReserveYocto = BigInt("50000000000000000000000"); // 0.05 NEAR
  const needYocto = quote ? BigInt(quote.totalYocto) + gasReserveYocto : null;
  const notEnough = needYocto !== null && balanceYocto !== null && BigInt(balanceYocto) < needYocto;

  const launch = async () => {
    if (!config || !quote || !valid || !accountId) return;
    setError(null);
    try {
      // Mandatory: a coin that is not about the song is not launched from here.
      setBusy("Checking the coin matches the song…");
      const v = await checkSongCoin(song.uuid, { name: form.name, symbol: form.symbol, description: form.description || undefined });
      if (!v.reviewed) {
        setBusy(null);
        setError("The relevance check is unavailable right now. Try again in a minute.");
        return;
      }
      if (!v.allowed) {
        setBusy(null);
        setError(`Doesn't look related to this song: ${v.reason}. Change the name or description and try again.`);
        return;
      }
      if (form.feeMode === "other" && form.feeTo) {
        setBusy("Checking the fee wallet…");
        if (!(await accountExists(form.feeTo))) {
          setBusy(null);
          setError(`Account ${form.feeTo} does not exist on NEAR. Fees sent there would be lost.`);
          return;
        }
      }
      setBusy("Preparing the transaction…");
      const nextId = await launchpad.nextLaunchId(view);
      const txs = launchpad.buildTransactions(form, quote.totalYocto, nextId);
      const { launch_enabled } = await dryRunSongCoin(song.uuid, launchpad.id, txs, quote);
      if (!launch_enabled) {
        setBusy(null);
        setPreview(txs.map((t) => ({ ...t, args: { ...t.args, args: t.args.args && typeof t.args.args === "object"
          ? { ...(t.args.args as Record<string, unknown>), icon: icon ? `<${icon.length} bytes>` : null } : t.args.args } })));
        setError("Coin launches are in test mode: nothing was sent to your wallet. The transaction below was recorded for review.");
        return;
      }
      setBusy("Confirm in your wallet…");
      const result = await callBatch(txs);
      const failure = txFailure(result);
      if (failure) {
        setBusy(null);
        setError(`The launch transaction failed, nothing was created: ${failure}`);
        return;
      }

      setBusy("Launching… waiting for the token to appear on chain");
      let coin: SongCoin | null = null;
      for (let i = 0; i < 40 && !coin; i++) {
        setBusy("Creating the token…");
        try {
          coin = await linkSongCoin(song.uuid, launchpad.id, form.symbol);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/not found on chain yet|Launch not found/i.test(msg)) throw e;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!coin) {
        setError("Launched, but the token is still being created. Reload this page in a minute to see it.");
        setBusy(null);
        return;
      }
      // The factory finishes token → pool → first buy over a few blocks. Wait
      // for it; a launch that stops moving can be resumed on the launchpad.
      let stalledPolls = 0;
      for (let i = 0; i < 45 && coin.status !== "live"; i++) {
        setBusy(form.devBuyYocto ? "Opening the pool and making your first buy…" : "Opening the pool…");
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const st = await launchpad.launchStatus(view, nextId);
          if (st.done) { coin = { ...coin, status: "live" }; break; }
          stalledPolls = st.inFlight ? 0 : stalledPolls + 1;
          if (stalledPolls >= 8) {
            setBusy(null);
            setError(`The launch stopped before the pool opened. Nothing is lost: open $${coin.symbol} on ${launchpad.name} and press Resume, or wait — it finishes on its own.`);
            onLaunched(coin);
            return;
          }
        } catch { /* transient RPC error: keep waiting */ }
      }
      showToast({ message: `$${coin.symbol} launched on ${launchpad.name}!`, type: "success", duration: 6000 });
      onLaunched(coin);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/user (rejected|closed|cancel)/i.test(msg) ? "Your wallet closed the approval, nothing was sent." : msg);
    }
    setBusy(null);
  };

  const field = "w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-purple-500/50";
  const label = "block text-xs font-medium text-slate-400 mb-1";
  const hint = "text-[11px] text-slate-600 mt-1.5";
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium border transition ${active ? "bg-purple-500/20 border-purple-500/50 text-purple-200" : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:bg-white/[0.06]"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" >
      <div className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-[#0f0f14] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Create a memecoin from this song</h2>
            <p className="text-xs text-slate-500 mt-0.5">You sign the launch in your own wallet and pay the launchpad&apos;s storage cost. near.fm takes nothing.</p>
          </div>
          <button onClick={onClose} disabled={!!busy} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        {/* Launchpad */}
        <div className="mb-5">
          <span className={label}>Launchpad</span>
          <div className="flex flex-wrap gap-2">
            {LAUNCHPADS.map((lp) => (
              <button
                key={lp.id}
                type="button"
                disabled={lp.comingSoon}
                onClick={() => setLaunchpad(lp)}
                title={lp.comingSoon ? "Coming soon" : lp.url}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition ${
                  launchpad.id === lp.id ? "border-purple-500/60 bg-purple-500/10 text-white" : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
                } ${lp.comingSoon ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lp.logo} alt="" className="w-5 h-5 rounded" />
                {lp.name}
                {lp.comingSoon && <span className="text-[10px] uppercase tracking-wide text-slate-500">soon</span>}
              </button>
            ))}
          </div>
          {configError && <p className="text-xs text-red-400 mt-2">{configError}</p>}
        </div>

        {/* Token */}
        <div className="flex items-center justify-between mb-2">
          <span className={label}>Token</span>
          <button type="button" onClick={suggest} disabled={suggesting || !!busy}
            className="text-xs px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-200 hover:bg-purple-500/25 disabled:opacity-50 transition">
            {suggesting ? "Thinking…" : "✨ Prepare with AI"}
          </button>
        </div>
        <div className="grid grid-cols-[auto,1fr] gap-4 mb-5">
          <div>
            <span className={label}>Logo</span>
            <label className="block w-20 h-20 rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.08] cursor-pointer relative">
              {icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={icon} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-500 text-center px-1">
                  {iconState === "loading" ? "…" : iconState === "failed" ? "Pick an image" : "No cover"}
                </span>
              )}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onPickIcon(e.target.files?.[0])} />
            </label>
            <p className="text-[10px] text-slate-600 mt-1 w-20">From the cover. Tap to change. Stored on chain, final.</p>
            {!icon && iconState !== "loading" && (
              <label className="flex items-start gap-1 mt-2 w-28 text-[10px] text-amber-300/80 cursor-pointer">
                <input type="checkbox" checked={noLogoOk} onChange={(e) => setNoLogoOk(e.target.checked)} className="mt-0.5" />
                <span>Launch without a logo (can&apos;t be added later)</span>
              </label>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <span className={label}>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={launchpad.limits.nameMax} className={field} />
              {problems.name && <p className="text-xs text-red-400 mt-1">{problems.name}</p>}
              <p className={hint}>Shown in wallets and on the launchpad. Up to {launchpad.limits.nameMax} characters, can&apos;t be changed after launch.</p>
            </div>
            <div>
              <span className={label}>Ticker</span>
              <div className="flex items-center">
                <span className="px-3 py-2 rounded-l-lg bg-white/[0.06] border border-r-0 border-white/[0.08] text-sm text-slate-400">$</span>
                <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))} className={`${field} rounded-l-none uppercase`} />
              </div>
              {problems.symbol && <p className="text-xs text-red-400 mt-1">{problems.symbol}</p>}
              <p className={hint}>The $TICKER people trade by, {launchpad.limits.symbolHint}. The token account is derived from it (e.g. nit.nearlytrade.near).</p>
            </div>
          </div>
        </div>
        <div className="mb-5">
          <span className={label}>Description <span className="text-slate-600">optional</span></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={launchpad.limits.descriptionMax} className={field} placeholder="What is this coin about?" />
          <p className={hint}>Shown on the token page. Keep the near.fm link so traders find the song.</p>
        </div>

        {/* Fees */}
        <div className="mb-5">
          <span className={label}>Pool fees go to</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(feeMode === "creator")} onClick={() => setFeeMode("creator")}>Your wallet</button>
            <button type="button" className={chip(feeMode === "other")} onClick={() => setFeeMode("other")}>Another wallet</button>
            <button type="button" className={chip(feeMode === "holders")} onClick={() => setFeeMode("holders")}>Holders</button>
          </div>
          {feeMode === "other" && (
            <div className="mt-2">
              <input value={feeTo} onChange={(e) => setFeeTo(e.target.value.toLowerCase())} placeholder="account.near" className={field} />
              {problems.feeTo && <p className="text-xs text-red-400 mt-1">{problems.feeTo}</p>}
            </div>
          )}
          <p className={hint}>Every trade pays a 1% pool fee; 70% of it is the creator share, paid out automatically about every hour. <b>Your wallet</b> — to you. <b>Another wallet</b> — to any NEAR account you name. <b>Holders</b> — sold for the pair asset and split among holders by balance. Locked at launch.</p>
        </div>

        {/* Tax */}
        <div className="mb-5">
          <span className={label}>Tax <span className="text-slate-600">optional, up to 4% a side, locked at launch</span></span>
          <p className={`${hint} mb-2`}>An extra cut taken in the token on every buy and/or sell on top of the 1% pool fee (max 5% total). Wallet-to-wallet transfers are never taxed. Where it goes: <b>You</b> — sold and sent to you; <b>Burn</b> — removed from supply; <b>Holders</b> — paid pro rata to holders.</p>
          <div className="grid grid-cols-2 gap-3">
            {([["Buy", buyTax, setBuyTax], ["Sell", sellTax, setSellTax]] as const).map(([lbl, val, set]) => (
              <div key={lbl}>
                <span className="text-[11px] text-slate-500">{lbl}</span>
                <div className="flex gap-1 mt-1">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <button key={n} type="button" className={chip(val === n)} onClick={() => set(n)}>{n === 0 ? "Off" : `${n}%`}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {tax && (
            <div className="mt-3">
              <span className="text-[11px] text-slate-500">Tax goes to</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {launchpad.taxPresets.map((p, i) => (
                  <button key={p.label} type="button" className={chip(!customSplit && taxPreset === i)} onClick={() => { setTaxPreset(i); setCustomSplit(null); }}>{p.label}</button>
                ))}
                <button type="button" className={chip(!!customSplit)} onClick={() => setCustomSplit(customSplit ?? launchpad.taxPresets[taxPreset]?.split ?? { creator_bps: 10000, burn_bps: 0, holders_bps: 0 })}>Customize</button>
              </div>
              {customSplit ? (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {([["You", "creator_bps"], ["Burn", "burn_bps"], ["Holders", "holders_bps"]] as const).map(([lbl, k]) => (
                    <div key={k}>
                      <span className="text-[11px] text-slate-500">{lbl} %</span>
                      <input type="number" min={0} max={100} value={customSplit[k] / 100}
                        onChange={(e) => setCustomSplit({ ...customSplit, [k]: Math.max(0, Math.min(100, Math.round(Number(e.target.value)))) * 100 })}
                        className={field} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-600 mt-1.5">
                  {tax.creator_bps / 100}% to you · {tax.burn_bps / 100}% burned · {tax.holders_bps / 100}% to holders
                </p>
              )}
              {problems.tax && <p className="text-xs text-red-400 mt-1">{problems.tax}</p>}
            </div>
          )}
        </div>

        {/* Pair */}
        {config && config.pairs.length > 1 && (
          <div className="mb-5">
            <span className={label}>Pair it with <span className="text-slate-600">what buyers pay in</span></span>
            <p className={`${hint} mb-2`}>The asset the pool holds against your token and that fees arrive in. NEAR is the default; a USDC/USDT pair opens at the same ~$5K value. First buy is only available on NEAR.</p>
            <div className="flex flex-wrap gap-2">
              {config.pairs.map((p) => (
                <button key={p.tokenId} type="button" className={chip((pairOption?.tokenId ?? "") === p.tokenId)} onClick={() => { setPair(p.tokenId); if (!p.native) setDevBuy(""); }}>{p.symbol}</button>
              ))}
            </div>
          </div>
        )}

        {/* First buy */}
        {isNativePair && config && (
          <div className="mb-5">
            <span className={label}>Your first buy <span className="text-slate-600">optional, max {fmtNear(config.devBuyCapYocto, 1)} NEAR (4% of supply)</span></span>
            <div className="flex items-center">
              <input type="number" min={0} step="0.1" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} placeholder="0" className={`${field} rounded-r-none`} />
              <span className="px-3 py-2 rounded-r-lg bg-white/[0.06] border border-l-0 border-white/[0.08] text-sm text-slate-400">NEAR</span>
            </div>
            {problems.devBuy && <p className="text-xs text-red-400 mt-1">{problems.devBuy}</p>}
            <p className={hint}>Buys tokens for you from the pool the moment it opens, at the opening price, before anyone else. Paid on top of the launch cost; pays the pool fee and any buy tax like every buy.</p>
          </div>
        )}

        {/* Links */}
        <p className={`${hint} mb-2`}>Links shown on the token page. X and Telegram accept @handles.</p>
        <div className="mb-5 grid sm:grid-cols-3 gap-2">
          {([["Website", website, setWebsite, "https://", "website"], ["X", twitter, setTwitter, "@handle", "twitter"], ["Telegram", telegram, setTelegram, "@group", "telegram"]] as const).map(([lbl, val, set, ph, key]) => (
            <div key={lbl}>
              <span className={label}>{lbl} <span className="text-slate-600">optional</span></span>
              <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} className={field} />
              {problems[key] && <p className="text-xs text-red-400 mt-1">{problems[key]}</p>}
            </div>
          ))}
        </div>

        <p className="mb-5 text-xs text-slate-500">Before launching, the coin is checked to be about this song.</p>

        {/* Cost + launch */}
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 mb-4 text-sm">
          <div className="flex justify-between text-slate-400"><span>1B supply · opens at {config?.openingFdvLabel ?? "…"} FDV</span></div>
          {quote?.items.map((it) => (
            <div key={it.label} className="flex justify-between text-slate-400 mt-1"><span>{it.label}</span><span>{fmtNear(it.yocto)} NEAR</span></div>
          ))}
          <div className="flex justify-between text-white font-medium mt-2 pt-2 border-t border-white/[0.06]">
            <span>Total</span><span>{quote ? `${fmtNear(quote.totalYocto)} NEAR` : "…"}</span>
          </div>
          {balanceYocto !== null && (
            <p className={`text-[11px] mt-1 ${notEnough ? "text-red-400" : "text-slate-600"}`}>
              Wallet: {fmtNear(balanceYocto, 2)} NEAR{notEnough && needYocto ? ` — needs ${fmtNear(needYocto.toString(), 2)} incl. gas` : ""}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        {preview && (
          <div className="mb-3">
            <button type="button" onClick={() => navigator.clipboard.writeText(JSON.stringify(preview, null, 2))} className="text-xs text-purple-300 hover:text-purple-200 mb-1">Copy transaction JSON</button>
            <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 border border-white/[0.06] p-3 text-[10px] text-slate-400 whitespace-pre-wrap break-all">
              {JSON.stringify(preview, null, 2)}
            </pre>
          </div>
        )}

        <button
          onClick={launch}
          disabled={!valid || !quote || !!busy || notEnough || launchpad.comingSoon || !accountId}
          className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-500 to-cyan-500 disabled:opacity-40 transition"
        >
          {busy ?? `Launch $${symbolUpper || "…"} on ${launchpad.name}`}
        </button>
        <p className="text-[11px] text-slate-600 mt-3">
          Tokens are created by you on {launchpad.name}; near.fm does not review, endorse or trade them. Prices are volatile and can go to zero.
        </p>
      </div>
    </div>
  );
}
