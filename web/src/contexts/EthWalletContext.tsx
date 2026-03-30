"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface EthWalletContextValue {
  ethAddress: string | null;
  connectAndSignIn: () => Promise<void>;
  linkEthWallet: () => Promise<boolean>;
  disconnectEth: () => void;
}

const EthWalletContext = createContext<EthWalletContextValue>({
  ethAddress: null,
  connectAndSignIn: async () => {},
  linkEthWallet: async () => false,
  disconnectEth: () => {},
});

export const useEthWallet = () => useContext(EthWalletContext);

function getEthProvider(): any {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum;
}

async function connectAndSign(action: "sign_in" | "link_wallet", endpoint: string): Promise<string> {
  const provider = getEthProvider();
  if (!provider) {
    window.open("https://metamask.io/", "_blank");
    throw new Error("No Ethereum wallet found. Please install MetaMask or another EVM wallet.");
  }

  // Request accounts (triggers wallet popup)
  const accounts: string[] = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts.length) throw new Error("No accounts found");
  const address = accounts[0].toLowerCase();

  // Sign message (EIP-191 personal_sign)
  const message = JSON.stringify({
    action,
    domain: "near.fm",
    version: 1,
    timestamp: Date.now(),
  });

  const signature: string = await provider.request({
    method: "personal_sign",
    params: [message, address],
  });

  // Send to server
  const apiResp = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eth_address: address,
      signature,
      message,
    }),
  });

  if (!apiResp.ok) {
    const text = await apiResp.text();
    throw new Error(text || `Auth failed: ${apiResp.status}`);
  }

  await apiResp.json();
  return address;
}

export function EthWalletProvider({ children }: { children: ReactNode }) {
  const [ethAddress, setEthAddress] = useState<string | null>(null);

  const connectAndSignIn = useCallback(async () => {
    try {
      const addr = await connectAndSign("sign_in", "/api/auth/ethereum/verify");
      setEthAddress(addr);
      window.dispatchEvent(new Event("nearfm_session_changed"));
    } catch (e: any) {
      if (e?.message?.includes("User rejected") || e?.code === 4001) return;
      console.error("Ethereum sign-in failed:", e);
    }
  }, []);

  const linkEthWallet = useCallback(async () => {
    try {
      const addr = await connectAndSign("link_wallet", "/api/auth/link-ethereum");
      setEthAddress(addr);
      window.dispatchEvent(new Event("nearfm_session_changed"));
      return true;
    } catch (e) {
      console.error("Ethereum link failed:", e);
      return false;
    }
  }, []);

  const disconnectEth = useCallback(() => {
    setEthAddress(null);
  }, []);

  const value = useMemo(
    () => ({ ethAddress, connectAndSignIn, linkEthWallet, disconnectEth }),
    [ethAddress, connectAndSignIn, linkEthWallet, disconnectEth],
  );

  return <EthWalletContext.Provider value={value}>{children}</EthWalletContext.Provider>;
}
