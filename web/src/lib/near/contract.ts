/**
 * NEAR smart contract interaction helpers for near-fm.
 */

const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID || "near-fm.testnet";

/**
 * Tip a song uploader directly with attached NEAR.
 */
export function tipSongAction(recipient: string, songUuid: string, amountYocto: string) {
  return {
    contractId: CONTRACT_ID,
    method: "tip",
    args: { recipient, song_uuid: songUuid },
    gas: "30000000000000", // 30 TGas
    deposit: amountYocto,
  };
}

/**
 * Tip from virtual balance (no deposit needed, uses function call key).
 */
export function tipFromBalanceArgs(
  recipient: string,
  amountYocto: string,
  songUuid: string
) {
  return {
    contractId: CONTRACT_ID,
    method: "tip_from_balance",
    args: { recipient, amount: amountYocto, song_uuid: songUuid },
    gas: "30000000000000",
  };
}

/**
 * Deposit NEAR into virtual balance.
 */
export function depositAction(amountYocto: string) {
  return {
    contractId: CONTRACT_ID,
    method: "deposit",
    args: {},
    gas: "30000000000000",
    deposit: amountYocto,
  };
}

/**
 * Withdraw NEAR from virtual balance.
 */
export function withdrawAction(amountYocto: string) {
  return {
    contractId: CONTRACT_ID,
    method: "withdraw",
    args: { amount: amountYocto },
    gas: "30000000000000",
  };
}

/**
 * Create a song request bounty.
 */
export function createBountyAction(requestUuid: string, amountYocto: string) {
  return {
    contractId: CONTRACT_ID,
    method: "create_bounty",
    args: { request_uuid: requestUuid },
    gas: "30000000000000",
    deposit: amountYocto,
  };
}

/**
 * Award bounty to a song uploader.
 */
export function awardBountyAction(requestUuid: string, recipient: string) {
  return {
    contractId: CONTRACT_ID,
    method: "award_bounty",
    args: { request_uuid: requestUuid, recipient },
    gas: "30000000000000",
  };
}

/**
 * Withdraw bounty (with penalty).
 */
export function withdrawBountyAction(requestUuid: string) {
  return {
    contractId: CONTRACT_ID,
    method: "withdraw_bounty",
    args: { request_uuid: requestUuid },
    gas: "30000000000000",
  };
}

/**
 * View: get virtual balance.
 */
export async function getBalance(
  viewCall: (params: {
    contractId: string;
    method: string;
    args: Record<string, unknown>;
  }) => Promise<string>,
  accountId: string
): Promise<string> {
  return viewCall({
    contractId: CONTRACT_ID,
    method: "get_balance",
    args: { account_id: accountId },
  });
}
