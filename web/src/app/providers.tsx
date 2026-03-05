"use client";

import { NearWalletProvider } from "@/contexts/NearWalletContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import { ToastProvider } from "@/components/ui/Toast";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NearWalletProvider>
      <AuthProvider>
        <AudioPlayerProvider>
          <ToastProvider>{children}</ToastProvider>
        </AudioPlayerProvider>
      </AuthProvider>
    </NearWalletProvider>
  );
}
