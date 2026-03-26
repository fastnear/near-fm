const OUTLAYER_API = "https://api.outlayer.fastnear.com";
const STORAGE_KEY = "nearfm_outlayer_api_key";

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

function setApiKey(key: string) {
  localStorage.setItem(STORAGE_KEY, key);
}

async function outlayerFetch<T>(
  path: string,
  apiKey: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${OUTLAYER_API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text);
}

export async function register(): Promise<{
  api_key: string;
  near_account_id: string;
}> {
  const res = await fetch(`${OUTLAYER_API}/register`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Registration failed");
  }
  const data = await res.json();
  setApiKey(data.api_key);
  return data;
}

export async function ensureRegistered(): Promise<string> {
  let key = getApiKey();
  if (key) return key;
  const data = await register();
  return data.api_key;
}

export async function getAddress(
  apiKey: string
): Promise<{ address: string }> {
  return outlayerFetch("/wallet/v1/address?chain=near", apiKey);
}

export async function getIntentsBalance(
  apiKey: string,
  token: string
): Promise<{ balance: string }> {
  return outlayerFetch(
    `/wallet/v1/balance?token=${encodeURIComponent(token)}&source=intents`,
    apiKey
  );
}

// ── Solana deposit via 1Click bridge ──

export interface SolanaDepositIntent {
  intent_id: string;
  deposit_address: string;
  amount: string;
  amount_out: string;
  min_amount_out: string;
  expires_at: string;
  estimated_time_secs: number;
}

export interface SolanaDepositStatus {
  intent_id: string;
  status: "pending" | "bridging" | "success" | "failed" | "expired";
  result?: {
    amountOut: string;
    amountOutFormatted: string;
  };
}

export async function createSolanaDepositIntent(
  apiKey: string,
  amount: string,
  token: string,
  refundAddress: string,
): Promise<SolanaDepositIntent> {
  return outlayerFetch("/wallet/v1/solana/deposit-intent", apiKey, {
    method: "POST",
    body: JSON.stringify({ amount, token, refund_address: refundAddress }),
  });
}

export async function getSolanaDepositStatus(
  apiKey: string,
  intentId: string,
): Promise<SolanaDepositStatus> {
  return outlayerFetch(`/wallet/v1/solana/deposit-status?id=${intentId}`, apiKey);
}

export async function saveExternalAddresses(
  apiKey: string,
  addresses: Array<{ chain: string; address: string; label: string }>,
): Promise<void> {
  return outlayerFetch("/wallet/v1/external-addresses", apiKey, {
    method: "PUT",
    body: JSON.stringify({ addresses }),
  });
}

export async function createCheck(
  apiKey: string,
  token: string,
  amount: string
): Promise<{
  check_id: string;
  check_key: string;
  amount: string;
}> {
  return outlayerFetch("/wallet/v1/payment-check/create", apiKey, {
    method: "POST",
    body: JSON.stringify({ token, amount }),
  });
}
