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
import { verifyAuth } from "@/lib/api";

import "@near-wallet-selector/modal-ui/styles.css";

const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.testnet";
const FASTFS_RECEIVER =
  process.env.NEXT_PUBLIC_FASTFS_RECEIVER || "fastfs.testnet";
const NETWORK =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK as "testnet" | "mainnet") || "testnet";

// Detect subdomain to choose which contract gets the function call access key
const isUploadSubdomain =
  typeof window !== "undefined" && window.location.hostname.startsWith("upload.");
const SIGN_IN_CONTRACT = isUploadSubdomain ? FASTFS_RECEIVER : CONTRACT_ID;

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? match[1] : null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Domain=.near.fm; Path=/; Max-Age=0`;
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

interface NearWalletContextType {
  selector: WalletSelector | null;
  accountId: string | null;
  wallet: Wallet | null;
  loading: boolean;
  isAuthenticated: boolean;
  signIn: () => void;
  completeSignIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
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

const NearWalletContext = createContext<NearWalletContextType>({
  selector: null,
  accountId: null,
  wallet: null,
  loading: true,
  isAuthenticated: false,
  signIn: () => {},
  completeSignIn: async () => false,
  signOut: async () => {},
  callFunction: async () => "",
  viewMethod: async () => null,
});

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [signInModal, setSignInModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const pendingAuthRef = useRef(false);

  useEffect(() => {
    // Check session cookie
    setIsAuthenticated(!!getCookie("nearfm_session"));
    const onExpired = () => {
      clearCookie("nearfm_session");
      setIsAuthenticated(false);
    };
    window.addEventListener("nearfm_token_expired", onExpired);
    return () => window.removeEventListener("nearfm_token_expired", onExpired);
  }, []);

  const doApiAuth = useCallback(async (w: Wallet, accId: string) => {
    // Already have session cookie
    if (getCookie("nearfm_session")) {
      setIsAuthenticated(true);
      return;
    }

    if (!w.signMessage) {
      console.warn("Wallet does not support signMessage (NEP-413)");
      return;
    }

    const nonce = new Uint8Array(32);
    crypto.getRandomValues(nonce);

    const timestamp = Date.now();
    const message = JSON.stringify({
      action: "sign_in",
      domain: "near.fm",
      version: 1,
      timestamp,
    });

    const signed = await w.signMessage({
      message,
      nonce: Buffer.from(nonce),
      recipient: CONTRACT_ID,
    });

    if (!signed) return;

    // verifyAuth will set the session cookie via Set-Cookie header
    await verifyAuth({
      account_id: signed.accountId || accId,
      public_key: signed.publicKey,
      signature: signed.signature,
      message,
      nonce: Array.from(nonce),
      recipient: CONTRACT_ID,
    });

    setIsAuthenticated(true);
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

      // Sign-in modal — creates function call access key for the appropriate contract
      // near.fm → near-fm contract (tips/withdrawals)
      // upload.near.fm → FastFS contract (chunked uploads)
      const signMod = setupModal(sel, { contractId: SIGN_IN_CONTRACT });

      signMod.on("onHide", ({ hideReason }) => {
        if (hideReason === "user-triggered") pendingAuthRef.current = false;
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
        if (getCookie("nearfm_session")) {
          setIsAuthenticated(true);
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
            if (pendingAuthRef.current && !getCookie("nearfm_session")) {
              pendingAuthRef.current = false;
              await doApiAuth(w, accId);
            }
          } catch (e) {
            console.error("Auth error:", e);
          }
        } else {
          setAccountId(null);
          setWallet(null);
          clearCookie("nearfm_session");
          setIsAuthenticated(false);
        }
      });
    };

    init().catch(console.error);
  }, [doApiAuth]);

  // Sign in: wallet connect + signMessage for API auth
  const signIn = useCallback(() => {
    pendingAuthRef.current = true;
    signInModal?.show();
  }, [signInModal]);

  // Complete sign in: run signMessage with already-connected wallet
  const completeSignIn = useCallback(async (): Promise<boolean> => {
    if (!wallet || !accountId) return false;
    try {
      await doApiAuth(wallet, accountId);
      return true;
    } catch (e) {
      console.error("Complete sign-in failed:", e);
      return false;
    }
  }, [wallet, accountId, doApiAuth]);

  // Sign out: clears wallet connection + session cookie
  const signOut = useCallback(async () => {
    if (wallet) {
      await wallet.signOut();
    }
    setAccountId(null);
    setWallet(null);
    clearCookie("nearfm_session");
    setIsAuthenticated(false);
  }, [wallet]);

  // callFunction — tries the transaction directly, wallet handles access key prompts
  const callFunction = useCallback(
    async (params: {
      contractId: string;
      method: string;
      args: Record<string, unknown> | Uint8Array;
      gas?: string;
      deposit?: string;
    }) => {
      if (!wallet) {
        const err = new Error("Please connect your wallet to perform transactions");
        err.name = "WalletConnectionRequired";
        throw err;
      }

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
        isAuthenticated,
        signIn,
        completeSignIn,
        signOut,
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
