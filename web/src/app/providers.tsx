"use client";

import { NearWalletProvider } from "@/contexts/NearWalletContext";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NearWalletProvider>
      <AudioPlayerProvider>{children}</AudioPlayerProvider>
    </NearWalletProvider>
  );
}
