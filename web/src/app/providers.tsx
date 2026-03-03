"use client";

import { NearWalletProvider } from "@/contexts/NearWalletContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NearWalletProvider>
      <AuthProvider>
        <AudioPlayerProvider>{children}</AudioPlayerProvider>
      </AuthProvider>
    </NearWalletProvider>
  );
}
