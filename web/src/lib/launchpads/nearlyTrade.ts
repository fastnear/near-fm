/**
 * nearly.trade adapter — https://nearly.trade/docs ("Launching from a contract or script").
 *
 * `launch({args})` on `nearlytrade.near` with 300 TGas and the deposit from
 * `quote_launch`. The caller becomes the creator. Fixed 1B supply, a Rhea DCL
 * pool opens at launch, creator gets 70% of pool fees.
 */

import type { CostQuote, LaunchForm, Launchpad, LaunchpadConfig, LaunchTx, PairOption, ViewFn } from "./types";

export const FACTORY = "nearlytrade.near";
const LAUNCH_GAS = "300000000000000"; // 300 TGas
const RESUME_GAS = "300000000000000";
const NATIVE = "wrap.near";

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** The launch's own argument object, exactly as the factory reads it. */
export function launchArgs(form: LaunchForm): Record<string, unknown> {
  const args: Record<string, unknown> = {
    name: form.name.trim(),
    symbol: form.symbol.trim().toUpperCase(),
    description: form.description.trim() || null,
    icon: form.icon || null,
    links: form.links,
    dev_buy: form.devBuyYocto && form.devBuyYocto !== "0" ? form.devBuyYocto : null,
    quote: form.pair && form.pair !== NATIVE ? form.pair : null,
    fee_mode: form.feeMode === "holders" ? "holders" : null,
  };
  if (form.tax) args.tax = form.tax;
  if (form.feeMode === "other" && form.feeTo) args.fee_to = form.feeTo;
  return args;
}

async function symbolOf(view: ViewFn, tokenId: string): Promise<string> {
  if (tokenId === NATIVE) return "NEAR";
  try {
    const m = (await view(tokenId, "ft_metadata", {})) as { symbol?: string };
    return (m?.symbol || tokenId.split(".")[0]).toUpperCase();
  } catch {
    return tokenId.length > 16 ? `${tokenId.slice(0, 6)}…` : tokenId;
  }
}

export const nearlyTrade: Launchpad = {
  id: "nearly.trade",
  name: "nearly.trade",
  url: "https://nearly.trade",
  logo: "/launchpads/nearly-trade.svg",
  limits: {
    nameMax: 32,
    symbolPattern: /^[A-Z0-9]{2,12}$/,
    symbolHint: "2 to 12 letters or digits",
    descriptionMax: 500,
    linkMax: 200,
  },
  taxPresets: [
    { label: "Balanced", split: { creator_bps: 3300, burn_bps: 3300, holders_bps: 3400 } },
    { label: "Holders first", split: { creator_bps: 2000, burn_bps: 2000, holders_bps: 6000 } },
    { label: "Burn heavy", split: { creator_bps: 2000, burn_bps: 6000, holders_bps: 2000 } },
    { label: "All to you", split: { creator_bps: 10000, burn_bps: 0, holders_bps: 0 } },
  ],

  async loadConfig(view): Promise<LaunchpadConfig> {
    const [config, quotes, cap] = await Promise.all([
      view(FACTORY, "get_config", {}) as Promise<{ max_icon_bytes: number; max_dev_buy_bps: number }>,
      view(FACTORY, "get_quotes", {}) as Promise<[string, { decimals: number; native: boolean; enabled: boolean }][]>,
      view(FACTORY, "get_dev_buy_cap", {}) as Promise<string>,
    ]);
    const enabled = quotes.filter(([, q]) => q.enabled);
    const symbols = await Promise.all(enabled.map(([id]) => symbolOf(view, id)));
    const pairs: PairOption[] = enabled.map(([tokenId, q], i) => ({
      tokenId,
      symbol: symbols[i],
      decimals: q.decimals,
      native: q.native,
    }));
    pairs.sort((a, b) => Number(b.native) - Number(a.native));
    return {
      maxIconBytes: config.max_icon_bytes,
      maxTaxBps: 400,
      devBuyCapYocto: cap,
      pairs,
      openingFdvLabel: "1,000 NEAR",
    };
  },

  async quoteCost(view, form): Promise<CostQuote> {
    // quote_launch assumes 200 bytes of text: pass icon + name + symbol + description bytes.
    const iconBytes =
      utf8Bytes(form.icon || "") + utf8Bytes(form.name.trim()) + utf8Bytes(form.symbol) + utf8Bytes(form.description.trim());
    const q = (await view(FACTORY, "quote_launch", {
      icon_bytes: iconBytes,
      dev_buy: form.devBuyYocto && form.devBuyYocto !== "0" ? form.devBuyYocto : null,
      ...(form.tax ? { tax: true } : {}),
    })) as { launch_fee: string; token_storage: string; pool_create: string; dcl_storage: string; dev_buy: string; total: string };
    const items = [
      { label: "Token account", yocto: q.token_storage },
      { label: "Pool + position", yocto: (BigInt(q.pool_create) + BigInt(q.dcl_storage)).toString() },
    ];
    if (BigInt(q.launch_fee) > BigInt(0)) items.push({ label: "Launch fee", yocto: q.launch_fee });
    if (BigInt(q.dev_buy) > BigInt(0)) items.push({ label: "First buy", yocto: q.dev_buy });
    return { totalYocto: q.total, items };
  },

  async nextLaunchId(view): Promise<number> {
    return Number(await view(FACTORY, "get_num_launches", {}));
  },

  buildTransactions(form, totalYocto, nextLaunchId): LaunchTx[] {
    const txs: LaunchTx[] = [
      { contractId: FACTORY, method: "launch", args: { args: launchArgs(form) }, gas: LAUNCH_GAS, deposit: totalYocto },
    ];
    // With a first buy the factory pauses after the pool opens; `resume`
    // finishes the launch and delivers the buy (what nearly.trade's own UI sends).
    if (form.devBuyYocto && form.devBuyYocto !== "0") {
      txs.push({ contractId: FACTORY, method: "resume", args: { launch_id: String(nextLaunchId) }, gas: RESUME_GAS, deposit: "0" });
    }
    return txs;
  },

  tokenUrl(tokenAccount) {
    return `https://nearly.trade/${tokenAccount}`;
  },
};
