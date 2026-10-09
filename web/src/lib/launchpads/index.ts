import type { Launchpad } from "./types";
import { nearlyTrade } from "./nearlyTrade";

export type { Launchpad, LaunchForm, LaunchpadConfig, CostQuote, PairOption, Tax, TaxSplit, FeeMode, ViewFn } from "./types";

/** Launchpads shown in the picker. Placeholders are listed but not launchable. */
export const LAUNCHPADS: Launchpad[] = [
  nearlyTrade,
  placeholder("justhoot.fun", "JustHoot", "https://justhoot.fun", "/launchpads/justhoot.png"),
];

export function getLaunchpad(id: string): Launchpad | undefined {
  return LAUNCHPADS.find((l) => l.id === id);
}

function placeholder(id: string, name: string, url: string, logo: string): Launchpad {
  const notYet = () => Promise.reject(new Error(`${name} support is coming soon`));
  return {
    id,
    name,
    url,
    logo,
    comingSoon: true,
    limits: { nameMax: 32, symbolPattern: /^[A-Z0-9]{2,12}$/, symbolHint: "", descriptionMax: 500, linkMax: 200 },
    taxPresets: [],
    loadConfig: notYet,
    quoteCost: notYet,
    nextLaunchId: notYet,
    buildTransactions: () => [],
    tokenUrl: () => url,
  };
}
