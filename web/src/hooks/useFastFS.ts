import { useAuth } from "@/contexts/AuthContext";
import { useNearWallet } from "@/contexts/NearWalletContext";

/**
 * FastFS upload capability for the current user.
 * - NEAR wallet users: direct upload via wallet
 * - Solana/Ethereum users: upload via server relayer
 *
 * `canUseFastFS` — user can upload files (has some wallet connected)
 * `useRelayer` — uploads go through the server-side relayer (no NEAR wallet)
 */
export function useFastFS() {
  const { user } = useAuth();
  const { accountId } = useNearWallet();

  const hasNearWallet = !!accountId;
  const hasSolanaWallet = !!user?.solana_address;
  // Future: const hasEthWallet = !!user?.eth_address;

  const canUseFastFS = hasNearWallet || hasSolanaWallet;
  const useRelayer = !hasNearWallet && canUseFastFS;

  return { canUseFastFS, useRelayer, hasNearWallet };
}
