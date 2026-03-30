"use client";

import { NearWalletProvider } from "@/contexts/NearWalletContext";
import { SolanaWalletProvider } from "@/contexts/SolanaWalletContext";
import { EthWalletProvider } from "@/contexts/EthWalletContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import { ToastProvider } from "@/components/ui/Toast";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NearWalletProvider>
      <SolanaWalletProvider>
        <EthWalletProvider>
          <AuthProvider>
            <AudioPlayerProvider>
              <ToastProvider>{children}</ToastProvider>
            </AudioPlayerProvider>
          </AuthProvider>
        </EthWalletProvider>
      </SolanaWalletProvider>
    </NearWalletProvider>
  );
}
