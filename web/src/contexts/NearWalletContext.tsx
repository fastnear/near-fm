"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { setupWalletSelector } from "@near-wallet-selector/core";
import type {
  WalletSelector,
  Wallet,
} from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";

import { actionCreators } from "@near-js/transactions";
import { verifyAuth, linkWallet as linkWalletApi } from "@/lib/api";

import "@near-wallet-selector/modal-ui/styles.css";

const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.testnet";
const NETWORK =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK as "testnet" | "mainnet") || "testnet";

interface NearWalletContextType {
  selector: WalletSelector | null;
  accountId: string | null;
  wallet: Wallet | null;
  loading: boolean;
  signInPending: boolean;
  lowAllowance: boolean;
  connectWallet: () => void;
  connectAndSignIn: () => void;
  disconnectWallet: () => Promise<void>;
  reconnectWallet: () => Promise<void>;
  completeSignIn: () => Promise<boolean>;
  linkWallet: () => Promise<boolean>;
  callFunction: (params: {
    contractId: string;
    method: string;
    args: Record<string, unknown> | Uint8Array;
    gas?: string;
    deposit?: string;
  }) => Promise<string>;
  viewMethod: (params: {
    contractId: string;
    method: string;
    args: Record<string, unknown>;
  }) => Promise<unknown>;
}

const RPC_URL = NETWORK === "mainnet"
  ? "https://rpc.mainnet.fastnear.com"
  : "https://rpc.testnet.fastnear.com";

// Minimum allowance before warning (0.05 NEAR)
const MIN_ALLOWANCE = BigInt("50000000000000000000000");

const NearWalletContext = createContext<NearWalletContextType>({
  selector: null,
  accountId: null,
  wallet: null,
  loading: true,
  signInPending: false,
  lowAllowance: false,
  connectWallet: () => {},
  connectAndSignIn: () => {},
  disconnectWallet: async () => {},
  reconnectWallet: async () => {},
  completeSignIn: async () => false,
  linkWallet: async () => false,
  callFunction: async () => "",
  viewMethod: async () => null,
});

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [signInModal, setSignInModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [signInPending, setSignInPending] = useState(false);
  const [lowAllowance, setLowAllowance] = useState(false);

  const pendingAuthRef = useRef(false);
  const pendingLinkRef = useRef(false);

  // Sign NEP-413 message and return the payload for API calls
  const signNep413 = useCallback(async (w: Wallet, accId: string) => {
    if (!w.signMessage) {
      console.warn("Wallet does not support signMessage (NEP-413)");
      return null;
    }

    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);

    const message = JSON.stringify({
      action: "sign_in",
      domain: "near.fm",
      version: 1,
      timestamp: Date.now(),
    });

    const signed = await w.signMessage({
      message,
      nonce: Buffer.from(nonce),
      recipient: CONTRACT_ID,
    });

    if (!signed) return null;

    return {
      account_id: signed.accountId || accId,
      public_key: signed.publicKey,
      signature: signed.signature,
      message,
      nonce: Array.from(nonce),
      recipient: CONTRACT_ID,
    };
  }, []);

  const doApiAuth = useCallback(async (w: Wallet, accId: string) => {
    const payload = await signNep413(w, accId);
    if (!payload) {
      // signMessage failed or not supported — user needs to retry via button click
      setSignInPending(true);
      return;
    }
    await verifyAuth(payload);
    setSignInPending(false);
    sessionStorage.removeItem("nearfm_pending_auth");
    window.dispatchEvent(new Event("nearfm_session_changed"));
  }, [signNep413]);

  const doLinkWallet = useCallback(async (_w: Wallet, accId: string) => {
    await linkWalletApi({ account_id: accId });
    window.dispatchEvent(new Event("nearfm_session_changed"));
  }, []);

  // Check if the function call access key has enough allowance.
  // Uses the maximum allowance across all function call keys for the contract,
  // because after reconnect the old depleted key may still exist on-chain.
  const checkAllowance = useCallback(async (accId: string) => {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "allowance",
          method: "query",
          params: {
            request_type: "view_access_key_list",
            finality: "final",
            account_id: accId,
          },
        }),
      });
      const json = await res.json();
      if (!json.result?.keys) return;

      let maxAllowance = BigInt(-1);
      for (const key of json.result.keys) {
        const perm = key.access_key.permission;
        if (perm !== "FullAccess" && perm.FunctionCall?.receiver_id === CONTRACT_ID) {
          const allowance = BigInt(perm.FunctionCall.allowance);
          if (allowance > maxAllowance) {
            maxAllowance = allowance;
          }
        }
      }
      if (maxAllowance >= BigInt(0)) {
        setLowAllowance(maxAllowance < MIN_ALLOWANCE);
      }
    } catch (e) {
      console.error("Failed to check key allowance:", e);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const sel = await setupWalletSelector({
        network: NETWORK,
        modules: [
          setupMyNearWallet(),
          setupMeteorWallet(),
        ],
      });

      const signMod = setupModal(sel, { contractId: CONTRACT_ID });

      signMod.on("onHide", ({ hideReason }) => {
        if (hideReason === "user-triggered") {
          pendingAuthRef.current = false;
          pendingLinkRef.current = false;
          sessionStorage.removeItem("nearfm_pending_auth");
        }
      });

      setSelector(sel);
      setSignInModal(signMod);

      const state = sel.store.getState();
      const accounts = state.accounts;
      if (accounts.length > 0) {
        const acc = accounts[0];
        setAccountId(acc.accountId);
        const w = await sel.wallet();
        setWallet(w);

        // Check key allowance
        checkAllowance(acc.accountId);

        // If we returned from MNW redirect with pending auth, try to complete it
        if (sessionStorage.getItem("nearfm_pending_auth") === "1") {
          try {
            await doApiAuth(w, acc.accountId);
          } catch (e) {
            console.error("NEAR sign-in failed on init:", e);
            setSignInPending(true);
          }
        }
      }

      setLoading(false);

      sel.store.observable.subscribe(async (newState) => {
        const accounts = newState.accounts;
        if (accounts.length > 0) {
          const accId = accounts[0].accountId;
          setAccountId(accId);
          try {
            const w = await sel.wallet();
            setWallet(w);

            // Re-check allowance on every wallet (re)connect
            checkAllowance(accId);

            const shouldAuth = pendingAuthRef.current || sessionStorage.getItem("nearfm_pending_auth") === "1";
            if (shouldAuth) {
              pendingAuthRef.current = false;
              try {
                await doApiAuth(w, accId);
              } catch (e) {
                console.error("NEAR sign-in failed:", e);
                // Popup likely blocked by browser — let user retry via button
                setSignInPending(true);
              }
            } else if (pendingLinkRef.current) {
              pendingLinkRef.current = false;
              await doLinkWallet(w, accId);
            }
          } catch (e) {
            console.error("Wallet auth error:", e);
          }
        } else {
          setAccountId(null);
          setWallet(null);
        }
      });
    };

    init().catch(console.error);
  }, [doApiAuth, doLinkWallet]);

  // Connect wallet without signing in (just wallet connection)
  const connectWallet = useCallback(() => {
    signInModal?.show();
  }, [signInModal]);

  // Connect wallet + sign message for API auth (NEAR sign-in flow)
  const connectAndSignIn = useCallback(() => {
    pendingAuthRef.current = true;
    sessionStorage.setItem("nearfm_pending_auth", "1");
    signInModal?.show();
  }, [signInModal]);

  // Complete sign in with already-connected wallet (should be called from user gesture)
  const completeSignIn = useCallback(async (): Promise<boolean> => {
    if (!wallet || !accountId) return false;
    try {
      await doApiAuth(wallet, accountId);
      setSignInPending(false);
      sessionStorage.removeItem("nearfm_pending_auth");
      return true;
    } catch (e) {
      console.error("Complete sign-in failed:", e);
      return false;
    }
  }, [wallet, accountId, doApiAuth]);

  // Link NEAR wallet to existing (Google) account
  const linkWallet = useCallback(async (): Promise<boolean> => {
    if (!wallet || !accountId) {
      // Need to connect wallet first
      pendingLinkRef.current = true;
      signInModal?.show();
      return false;
    }
    try {
      await doLinkWallet(wallet, accountId);
      return true;
    } catch (e) {
      console.error("Link wallet failed:", e);
      return false;
    }
  }, [wallet, accountId, doLinkWallet, signInModal]);

  // Disconnect wallet
  const disconnectWallet = useCallback(async () => {
    if (wallet) {
      await wallet.signOut();
    }
    setAccountId(null);
    setWallet(null);
    setSignInPending(false);
    setLowAllowance(false);
    sessionStorage.removeItem("nearfm_pending_auth");
  }, [wallet]);

  // Reconnect wallet (disconnect + show modal for fresh key)
  const reconnectWallet = useCallback(async () => {
    await disconnectWallet();
    pendingAuthRef.current = true;
    sessionStorage.setItem("nearfm_pending_auth", "1");
    signInModal?.show();
  }, [disconnectWallet, signInModal]);

  // Auto-disconnect wallet when user signs out
  useEffect(() => {
    const onSignedOut = () => {
      disconnectWallet().catch(() => {});
    };
    window.addEventListener("nearfm_signed_out", onSignedOut);
    return () => window.removeEventListener("nearfm_signed_out", onSignedOut);
  }, [disconnectWallet]);

  // callFunction — tries the transaction directly
  const callFunction = useCallback(
    async (params: {
      contractId: string;
      method: string;
      args: Record<string, unknown> | Uint8Array;
      gas?: string;
      deposit?: string;
    }) => {
      if (!wallet) {
        const err = new Error("Please connect your NEAR wallet to perform transactions");
        err.name = "WalletConnectionRequired";
        throw err;
      }

      try {
        const result = await wallet.signAndSendTransaction({
          receiverId: params.contractId,
          actions: [
            actionCreators.functionCall(
              params.method,
              params.args instanceof Uint8Array
                ? params.args
                : params.args,
              BigInt(params.gas || "30000000000000"),
              BigInt(params.deposit || "0"),
            ),
          ],
        });

        const txHash =
          (result as { transaction?: { hash?: string } })?.transaction?.hash || "";
        return txHash;
      } catch (e: any) {
        const msg = e?.message || e?.toString() || "";
        if (msg.includes("NotEnoughAllowance") || msg.includes("does not have enough balance")) {
          setLowAllowance(true);
          const err = new Error("Your session key has run out of gas allowance. Please reconnect your wallet.");
          err.name = "NotEnoughAllowance";
          throw err;
        }
        throw e;
      }
    },
    [wallet]
  );

  const viewMethod = useCallback(
    async (params: {
      contractId: string;
      method: string;
      args: Record<string, unknown>;
    }) => {
      const rpcUrl =
        NETWORK === "mainnet"
          ? "https://rpc.mainnet.fastnear.com"
          : "https://rpc.testnet.fastnear.com";

      const argsBase64 = btoa(JSON.stringify(params.args));

      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "dontcare",
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: params.contractId,
            method_name: params.method,
            args_base64: argsBase64,
          },
        }),
      });

      const json = await res.json();
      if (json.error) throw new Error(JSON.stringify(json.error));

      const bytes = json.result.result;
      const str = String.fromCharCode(...bytes);
      return JSON.parse(str);
    },
    []
  );

  return (
    <NearWalletContext.Provider
      value={{
        selector,
        accountId,
        wallet,
        loading,
        signInPending,
        lowAllowance,
        connectWallet,
        connectAndSignIn,
        disconnectWallet,
        reconnectWallet,
        completeSignIn,
        linkWallet,
        callFunction,
        viewMethod,
      }}
    >
      {children}
    </NearWalletContext.Provider>
  );
}

export function useNearWallet() {
  return useContext(NearWalletContext);
}
