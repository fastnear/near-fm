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
  modal: WalletSelectorModal | null;
  accountId: string | null;
  wallet: Wallet | null;
  loading: boolean;
  isAuthenticated: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  ensureWalletConnected: () => void;
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
  modal: null,
  accountId: null,
  wallet: null,
  loading: true,
  isAuthenticated: false,
  signIn: () => {},
  signOut: async () => {},
  ensureWalletConnected: () => {},
  callFunction: async () => "",
  viewMethod: async () => null,
});

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Track whether we need to auto-authenticate after wallet connects
  const pendingAuthRef = useRef(false);

  useEffect(() => {
    setIsAuthenticated(!!localStorage.getItem("nearfm_token"));
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

    const signed = await w.signMessage({
      message: "Sign in to near.fm",
      nonce: Buffer.from(nonce),
      recipient: CONTRACT_ID,
    });

    if (!signed) return;

    const result = await verifyAuth({
      account_id: signed.accountId || accId,
      public_key: signed.publicKey,
      signature: signed.signature,
      message: "Sign in to near.fm",
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

      // No contractId — light connection for signing only.
      // Function call access keys are added later when needed for transactions.
      const mod = setupModal(sel, {
        contractId: FASTFS_RECEIVER,
      });

      setSelector(sel);
      setModal(mod);

      const state = sel.store.getState();
      const accounts = state.accounts;
      if (accounts.length > 0) {
        const acc = accounts[0];
        setAccountId(acc.accountId);
        const w = await sel.wallet();
        setWallet(w);
        // If wallet connected but no token (e.g. after redirect), auto-authenticate
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
            // Auto-authenticate after fresh wallet connection
            if (pendingAuthRef.current && !localStorage.getItem("nearfm_token")) {
              pendingAuthRef.current = false;
              await doApiAuth(w, accId);
            }
          } catch (e) {
            console.error("Wallet auth error:", e);
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

  // "Sign in" — opens wallet modal, then auto-authenticates with API
  const signIn = useCallback(() => {
    pendingAuthRef.current = true;
    modal?.show();
  }, [modal]);

  // "Sign out" — disconnects wallet and removes token
  const signOut = useCallback(async () => {
    if (wallet) {
      await wallet.signOut();
      setAccountId(null);
      setWallet(null);
      localStorage.removeItem("nearfm_token");
      setIsAuthenticated(false);
    }
  }, [wallet]);

  // For tips/transactions — ensure wallet has function call access key
  const ensureWalletConnected = useCallback(() => {
    if (!wallet) {
      modal?.show();
    }
  }, [wallet, modal]);

  const callFunction = useCallback(
    async (params: {
      contractId: string;
      method: string;
      args: Record<string, unknown> | Uint8Array;
      gas?: string;
      deposit?: string;
    }) => {
      if (!wallet) throw new Error("Wallet not connected");

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
        modal,
        accountId,
        wallet,
        loading,
        isAuthenticated,
        signIn,
        signOut,
        ensureWalletConnected,
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
