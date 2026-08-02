#!/usr/bin/env bash
set -euo pipefail

API="https://api.outlayer.fastnear.com/wallet/v1"
USDC_TOKEN="nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
USDT_TOKEN="nep141:usdt.tether-token.near"

KEY="${1:-}"
RECIPIENT="${2:-}"

if [[ -z "$KEY" ]]; then
  echo "Usage: $0 <api-key> [recipient.near]"
  exit 1
fi

AUTH="Authorization: Bearer $KEY"

fetch_balance() {
  local token="$1"
  curl -sf -H "$AUTH" "$API/balance?source=intents&token=$token" | jq -r '.balance // "0"'
}

usdc_raw=$(fetch_balance "$USDC_TOKEN")
usdt_raw=$(fetch_balance "$USDT_TOKEN")

# Both USDC and USDT have 6 decimals
fmt() { echo "scale=6; $1 / 1000000" | bc | sed 's/^\./0./'; }

usdc=$(fmt "$usdc_raw")
usdt=$(fmt "$usdt_raw")

echo "=== Intents Balances ==="
echo "USDC: $usdc"
echo "USDT: $usdt"

if [[ -z "$RECIPIENT" ]]; then
  exit 0
fi

if [[ "$RECIPIENT" != *.near ]]; then
  echo "Error: recipient must end with .near"
  exit 1
fi

withdraw() {
  local token_id="$1"
  local amount="$2"
  local label="$3"

  if [[ "$amount" == "0" ]]; then
    echo "$label: nothing to send"
    return
  fi

  echo "Sending $label ($amount) to $RECIPIENT..."
  resp=$(curl -s -w $'\n%{http_code}' -H "$AUTH" -H "Content-Type: application/json" \
    -X POST "$API/intents/withdraw" \
    -d "{\"to\":\"$RECIPIENT\",\"amount\":\"$amount\",\"token\":\"$token_id\",\"chain\":\"near\"}")
  code=$(printf '%s\n' "$resp" | tail -n1)
  body=$(printf '%s\n' "$resp" | sed '$d')

  if [[ "$code" != "200" ]]; then
    echo "$label: failed (HTTP $code) — $body"
    return
  fi

  status=$(echo "$body" | jq -r '.status // empty' 2>/dev/null || true)
  if [[ "$status" == "success" ]]; then
    echo "$label: sent"
  else
    echo "$label: unexpected response — $body"
  fi
}

echo ""
echo "=== Sending to $RECIPIENT ==="
withdraw "$USDC_TOKEN" "$usdc_raw" "USDC"
withdraw "$USDT_TOKEN" "$usdt_raw" "USDT"
