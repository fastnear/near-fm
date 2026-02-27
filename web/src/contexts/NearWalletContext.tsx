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
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";

import { actionCreators } from "@near-js/transactions";
import { verifyAuth } from "@/lib/api";

import "@near-wallet-selector/modal-ui/styles.css";

const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.testnet";
const FASTFS_RECEIVER =
  process.env.NEXT_PUBLIC_FASTFS_RECEIVER || "fastfs.testnet";
const NETWORK =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK as "testnet" | "mainnet") || "testnet";

interface NearWalletContextType {
  selector: WalletSelector | null;
  accountId: string | null;
  wallet: Wallet | null;
  loading: boolean;
  isAuthenticated: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  connectForTransactions: () => void;
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
  signOut: async () => {},
  connectForTransactions: () => {},
  callFunction: async () => "",
  viewMethod: async () => null,
});

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [signInModal, setSignInModal] = useState<WalletSelectorModal | null>(null);
  const [txModal, setTxModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const pendingAuthRef = useRef(false);

  useEffect(() => {
    setIsAuthenticated(!!localStorage.getItem("nearfm_token"));
    const onExpired = () => setIsAuthenticated(false);
    window.addEventListener("nearfm_token_expired", onExpired);
    return () => window.removeEventListener("nearfm_token_expired", onExpired);
  }, []);

  const doApiAuth = useCallback(async (w: Wallet, accId: string) => {
    if (localStorage.getItem("nearfm_token")) {
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

    const result = await verifyAuth({
      account_id: signed.accountId || accId,
      public_key: signed.publicKey,
      signature: signed.signature,
      message,
      nonce: Array.from(nonce),
      recipient: CONTRACT_ID,
    });

    localStorage.setItem("nearfm_token", result.token);
    setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    const init = async () => {
      const sel = await setupWalletSelector({
        network: NETWORK,
        modules: [
          setupMyNearWallet(),
          setupMeteorWallet(),
          setupHereWallet(),
          setupIntearWallet(),
        ],
      });

      // Light modal for sign-in (no access key requested)
      const signMod = setupModal(sel, { contractId: "" });
      // Full modal for transactions (requests function call access key)
      const txMod = setupModal(sel, { contractId: FASTFS_RECEIVER });

      setSelector(sel);
      setSignInModal(signMod);
      setTxModal(txMod);

      const state = sel.store.getState();
      const accounts = state.accounts;
      if (accounts.length > 0) {
        const acc = accounts[0];
        setAccountId(acc.accountId);
        const w = await sel.wallet();
        setWallet(w);
        if (!localStorage.getItem("nearfm_token")) {
          try {
            await doApiAuth(w, acc.accountId);
          } catch (e) {
            console.error("Auto-auth failed:", e);
          }
        } else {
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
            if (pendingAuthRef.current && !localStorage.getItem("nearfm_token")) {
              pendingAuthRef.current = false;
              await doApiAuth(w, accId);
            }
          } catch (e) {
            console.error("Auth error:", e);
          }
        } else {
          setAccountId(null);
          setWallet(null);
          localStorage.removeItem("nearfm_token");
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

  // Sign out: clears wallet connection + API token
  const signOut = useCallback(async () => {
    if (wallet) {
      await wallet.signOut();
    }
    setAccountId(null);
    setWallet(null);
    localStorage.removeItem("nearfm_token");
    setIsAuthenticated(false);
  }, [wallet]);

  // For tips/uploads — connect with function call access key
  const connectForTransactions = useCallback(() => {
    txModal?.show();
  }, [txModal]);

  // callFunction — checks wallet, prompts connection if missing
  const callFunction = useCallback(
    async (params: {
      contractId: string;
      method: string;
      args: Record<string, unknown> | Uint8Array;
      gas?: string;
      deposit?: string;
    }) => {
      if (!wallet) {
        txModal?.show();
        throw new Error("Please connect your wallet to perform transactions");
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
    [wallet, txModal]
  );

  const viewMethod = useCallback(
    async (params: {
      contractId: string;
      method: string;
      args: Record<string, unknown>;
    }) => {
      const rpcUrl =
        NETWORK === "mainnet"
          ? "https://rpc.mainnet.near.org"
          : "https://rpc.testnet.near.org";

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
        signOut,
        connectForTransactions,
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
