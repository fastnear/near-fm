"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { setupWalletSelector } from "@near-wallet-selector/core";
import type {
  WalletSelector,
  AccountState,
  Wallet,
} from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";

import { actionCreators } from "@near-js/transactions";

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
  signIn: () => void;
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
  modal: null,
  accountId: null,
  wallet: null,
  loading: true,
  signIn: () => {},
  signOut: async () => {},
  callFunction: async () => "",
  viewMethod: async () => null,
});

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

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

      // Use FASTFS_RECEIVER as the contractId so that during sign-in,
      // the wallet creates a function call access key for the FastFS contract.
      // This enables local signing for large FastFS upload transactions
      // (redirect-based wallets like MyNearWallet can't handle 1MB+ payloads in URLs).
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
      }

      setLoading(false);

      // Listen for account changes
      sel.store.observable.subscribe((state) => {
        const accounts = state.accounts;
        if (accounts.length > 0) {
          setAccountId(accounts[0].accountId);
        } else {
          setAccountId(null);
          setWallet(null);
        }
      });
    };

    init().catch(console.error);
  }, []);

  const signIn = useCallback(() => {
    modal?.show();
  }, [modal]);

  const signOut = useCallback(async () => {
    if (wallet) {
      await wallet.signOut();
      setAccountId(null);
      setWallet(null);
      localStorage.removeItem("nearfm_token");
    }
  }, [wallet]);

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

      // Extract tx hash from result
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
        signIn,
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
