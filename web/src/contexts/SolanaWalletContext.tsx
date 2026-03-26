"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import bs58 from "bs58";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface SolanaWalletContextValue {
  solanaAddress: string | null;
  connectAndSignIn: () => Promise<void>;
  linkSolanaWallet: () => Promise<boolean>;
  disconnectSolana: () => void;
}

const SolanaWalletContext = createContext<SolanaWalletContextValue>({
  solanaAddress: null,
  connectAndSignIn: async () => {},
  linkSolanaWallet: async () => false,
  disconnectSolana: () => {},
});

export const useSolanaWallet = () => useContext(SolanaWalletContext);

function getPhantomProvider(): any {
  if (typeof window === "undefined") return null;
  // Phantom injects window.phantom.solana
  return (window as any).phantom?.solana || (window as any).solana;
}

async function connectAndSign(action: "sign_in" | "link_wallet", endpoint: string): Promise<string> {
  const provider = getPhantomProvider();
  if (!provider) {
    window.open("https://phantom.app/", "_blank");
    throw new Error("Phantom wallet not found. Please install it.");
  }

  // Connect (will show Phantom popup if not already connected)
  const resp = await provider.connect();
  const pubkeyB58: string = resp.publicKey.toBase58();

  // Sign message
  const message = JSON.stringify({
    action,
    domain: "near.fm",
    version: 1,
    timestamp: Date.now(),
  });

  const encoded = new TextEncoder().encode(message);
  const { signature } = await provider.signMessage(encoded, "utf8");
  const signatureB58 = bs58.encode(signature);

  // Send to server
  const apiResp = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      solana_address: pubkeyB58,
      signature: signatureB58,
      message,
    }),
  });

  if (!apiResp.ok) {
    const text = await apiResp.text();
    throw new Error(text || `Auth failed: ${apiResp.status}`);
  }

  await apiResp.json();
  return pubkeyB58;
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);

  const connectAndSignIn = useCallback(async () => {
    try {
      const addr = await connectAndSign("sign_in", "/api/auth/solana/verify");
      setSolanaAddress(addr);
      window.dispatchEvent(new Event("nearfm_session_changed"));
    } catch (e: any) {
      if (e?.message?.includes("User rejected")) return;
      console.error("Solana sign-in failed:", e);
    }
  }, []);

  const linkSolanaWallet = useCallback(async () => {
    try {
      const addr = await connectAndSign("link_wallet", "/api/auth/link-solana");
      setSolanaAddress(addr);
      window.dispatchEvent(new Event("nearfm_session_changed"));
      return true;
    } catch (e) {
      console.error("Solana link failed:", e);
      return false;
    }
  }, []);

  const disconnectSolana = useCallback(() => {
    const provider = getPhantomProvider();
    if (provider) provider.disconnect().catch(() => {});
    setSolanaAddress(null);
  }, []);

  const value = useMemo(
    () => ({ solanaAddress, connectAndSignIn, linkSolanaWallet, disconnectSolana }),
    [solanaAddress, connectAndSignIn, linkSolanaWallet, disconnectSolana],
  );

  return <SolanaWalletContext.Provider value={value}>{children}</SolanaWalletContext.Provider>;
}
