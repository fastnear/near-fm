const OUTLAYER_API = "https://api.outlayer.ai";
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

// ── Money operations (API 0.1.0-alpha.3 semantics) ──
//
// A write can answer 200 with `status: "processing"` (or "creating") and a
// `poll_url`: the funds were handed over, the outcome is not known yet. Follow
// it to a final status; never re-send a processing call under a new key (that
// can pay twice). A re-sent key runs nothing and answers its request.

export type OutlayerOpErrorKind =
  | "never_executed" // nothing moved — safe to retry under a NEW key
  | "failed" // may have moved funds — reconcile the balance before acting again
  | "needs_review" // outcome unknown — do not retry
  | "processing" // still running after our wait — do not retry
  | "http";

export class OutlayerOpError extends Error {
  constructor(message: string, public kind: OutlayerOpErrorKind, public requestId?: string) {
    super(message);
    this.name = "OutlayerOpError";
  }
}

/** Common shape of a money-operation answer or its polled request. */
export interface OpBody {
  status?: string;
  error?: string;
  message?: string;
  request_id?: string;
  poll_url?: string;
  result?: { never_executed?: boolean; never_submitted?: boolean; reason?: string };
  [key: string]: unknown;
}

const FINAL_OK = new Set(["success", "completed", "claimed", "partially_claimed", "unclaimed", "reclaimed"]);
const IN_FLIGHT = new Set(["processing", "creating", "pending"]);

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Classify a 2xx body: returns it when final-success, throws otherwise; null = in flight. */
function settle(data: OpBody): OpBody | null {
  if (data?.error && data.error !== "duplicate_idempotency_key") {
    throw new OutlayerOpError(data.message || data.error, "failed", data.request_id);
  }
  const status: string = data?.status ?? "";
  if (status === "" || FINAL_OK.has(status)) return data ?? {};
  if (IN_FLIGHT.has(status)) return null;
  if (status === "failed") {
    const never = data?.result?.never_executed || data?.result?.never_submitted;
    throw new OutlayerOpError(
      never ? "Operation was not executed — nothing moved" : `Operation failed${data?.result?.reason ? `: ${data.result.reason}` : ""}`,
      never ? "never_executed" : "failed",
      data?.request_id,
    );
  }
  if (status === "needs_review") {
    throw new OutlayerOpError("Outcome could not be confirmed — do not retry", "needs_review", data?.request_id);
  }
  throw new OutlayerOpError(`Operation ended '${status}'`, "failed", data?.request_id);
}

/**
 * POST a money operation with an idempotency key (mint it once per user
 * action and reuse it for that action's retries) and follow it to an outcome.
 */
export async function outlayerWrite<T = OpBody>(
  path: string,
  apiKey: string,
  body: unknown,
  idempotencyKey: string,
  followMs = 60_000,
): Promise<T> {
  let data: OpBody = {};
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${OUTLAYER_API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Idempotency-Key": idempotencyKey,
        "X-Answer-Within": "15",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    data = text ? (JSON.parse(text) as OpBody) : {};
    if (res.status === 409 && data?.error === "wallet_busy" && attempt < 3) {
      await sleep(2000); // same key: the duplicate answer resolves ours
      continue;
    }
    if (!res.ok) throw new OutlayerOpError(text || res.statusText, "http");
    break;
  }
  const done = settle(data);
  if (done) return done as unknown as T;

  const pollUrl: string = data.poll_url || `/wallet/v1/requests/${data.request_id}`;
  const deadline = Date.now() + followMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const polled = await outlayerFetch<OpBody>(pollUrl, apiKey);
    const final = settle(polled);
    if (final) return { ...data, ...final } as unknown as T;
  }
  throw new OutlayerOpError("Still processing — it will complete on its own", "processing", data.request_id);
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

// ── Cross-chain deposit via 1Click bridge ──

export interface DepositIntent {
  intent_id: string;
  deposit_address: string;
  amount: string;
  amount_out: string;
  min_amount_out: string;
  expires_at: string;
  estimated_time_secs: number;
}

export interface DepositStatus {
  intent_id: string;
  status: "pending" | "bridging" | "success" | "failed" | "expired";
  result?: {
    amountOut: string;
    amountOutFormatted: string;
  };
}

export async function createDepositIntent(
  apiKey: string,
  chain: string,
  amount: string,
  token: string,
): Promise<DepositIntent> {
  return outlayerFetch("/wallet/v1/deposit-intent", apiKey, {
    method: "POST",
    body: JSON.stringify({ chain, amount, token }),
  });
}

export async function getDepositStatus(
  apiKey: string,
  intentId: string,
): Promise<DepositStatus> {
  return outlayerFetch(`/wallet/v1/deposit-status?id=${intentId}`, apiKey);
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

// ── Intents swap ──

export interface SwapQuote {
  amount_out: string;
  min_amount_out: string;
  time_estimate_seconds: number;
}

export async function getSwapQuote(
  apiKey: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
): Promise<SwapQuote> {
  return outlayerFetch("/wallet/v1/intents/swap/quote", apiKey, {
    method: "POST",
    body: JSON.stringify({ token_in: tokenIn, token_out: tokenOut, amount_in: amountIn }),
  });
}

export async function executeSwap(
  apiKey: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  minAmountOut: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<{ intent_hash?: string }> {
  return outlayerWrite(
    "/wallet/v1/intents/swap",
    apiKey,
    { token_in: tokenIn, token_out: tokenOut, amount_in: amountIn, min_amount_out: minAmountOut },
    idempotencyKey,
  );
}

/** Gasless withdraw from the intents balance to an external chain address. */
export async function withdrawIntents(
  apiKey: string,
  body: { token: string; amount: string; chain: string; to: string },
  idempotencyKey: string = newIdempotencyKey(),
): Promise<OpBody> {
  return outlayerWrite("/wallet/v1/intents/withdraw", apiKey, body, idempotencyKey);
}

// ── Payment checks ──

export async function createCheck(
  apiKey: string,
  token: string,
  amount: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<{
  check_id: string;
  check_key: string;
  amount: string;
}> {
  // Followed until funded: a `creating` check cannot be claimed yet.
  return outlayerWrite("/wallet/v1/payment-check/create", apiKey, { token, amount }, idempotencyKey);
}
