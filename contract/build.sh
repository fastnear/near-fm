#!/bin/bash
set -e

echo "Building nearfm-contract..."

cargo near build non-reproducible-wasm --no-abi

mkdir -p res
cp target/near/nearfm_contract.wasm res/nearfm_contract.wasm

ls -lh res/nearfm_contract.wasm
echo "Build complete: res/nearfm_contract.wasm"

# near contract deploy near-fm.testnet use-file res/nearfm_contract.wasm with-init-call new json-args '{"owner":"near-fm.testnet"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
# near contract deploy near-fm.near use-file res/nearfm_contract.wasm with-init-call new json-args '{"owner":"owner.near-fm.near"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send