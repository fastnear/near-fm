"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface WalletInfo {
  name: string;
  icon: string;
  provider: any;
  uuid: string;
}

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

// ── EIP-6963: discover all injected EVM wallets ──

function discoverWallets(): Promise<WalletInfo[]> {
  return new Promise((resolve) => {
    const wallets: WalletInfo[] = [];
    const seen = new Set<string>();

    const handler = (event: any) => {
      const { info, provider } = event.detail || {};
      if (!info || !provider || seen.has(info.uuid)) return;
      seen.add(info.uuid);
      wallets.push({ name: info.name, icon: info.icon, provider, uuid: info.uuid });
    };

    window.addEventListener("eip6963:announceProvider", handler);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Give wallets 200ms to announce
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", handler);

      // Fallback: if no EIP-6963 wallets, use window.ethereum
      if (wallets.length === 0 && (window as any).ethereum) {
        const eth = (window as any).ethereum;
        wallets.push({
          name: eth.isMetaMask ? "MetaMask" : eth.isPhantom ? "Phantom" : "Ethereum Wallet",
          icon: "",
          provider: eth,
          uuid: "fallback",
        });
      }

      resolve(wallets);
    }, 200);
  });
}

// ── Wallet picker modal (inline, no external deps) ──

function showWalletPicker(wallets: WalletInfo[]): Promise<WalletInfo | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)";

    const card = document.createElement("div");
    card.style.cssText = "background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;max-width:360px;width:calc(100% - 32px)";

    const title = document.createElement("div");
    title.textContent = "Choose Wallet";
    title.style.cssText = "color:white;font-size:16px;font-weight:600;margin-bottom:16px";
    card.appendChild(title);

    const cleanup = () => { overlay.remove(); };

    wallets.forEach((w) => {
      const btn = document.createElement("button");
      btn.style.cssText = "width:100%;display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:8px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#e2e8f0;font-size:14px;cursor:pointer;transition:background 0.15s";
      btn.onmouseenter = () => { btn.style.background = "rgba(255,255,255,0.08)"; };
      btn.onmouseleave = () => { btn.style.background = "rgba(255,255,255,0.04)"; };

      if (w.icon) {
        const img = document.createElement("img");
        img.src = w.icon;
        img.style.cssText = "width:28px;height:28px;border-radius:6px";
        btn.appendChild(img);
      }

      const label = document.createElement("span");
      label.textContent = w.name;
      btn.appendChild(label);

      btn.onclick = () => { cleanup(); resolve(w); };
      card.appendChild(btn);
    });

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.cssText = "width:100%;padding:8px;margin-top:4px;color:#94a3b8;font-size:12px;background:none;border:none;cursor:pointer";
    cancel.onclick = () => { cleanup(); resolve(null); };
    card.appendChild(cancel);

    overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); resolve(null); } };
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

// ── Sign flow ──

async function connectAndSign(action: "sign_in" | "link_wallet", endpoint: string): Promise<string> {
  const wallets = await discoverWallets();

  if (wallets.length === 0) {
    window.open("https://metamask.io/", "_blank");
    throw new Error("No Ethereum wallet found. Please install MetaMask or another EVM wallet.");
  }

  // If only one wallet, use it directly. Otherwise show picker.
  let provider: any;
  if (wallets.length === 1) {
    provider = wallets[0].provider;
  } else {
    const picked = await showWalletPicker(wallets);
    if (!picked) throw new Error("User rejected");
    provider = picked.provider;
  }

  // Request accounts
  const accounts: string[] = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts.length) throw new Error("No accounts found");
  const address = accounts[0].toLowerCase();

  // Get connected chain
  const chainIdHex: string = await provider.request({ method: "eth_chainId" });
  const chainId = parseInt(chainIdHex, 16);

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
    body: JSON.stringify({ eth_address: address, signature, message, chain_id: chainId }),
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
