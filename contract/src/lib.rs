use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{env, log, near_bindgen, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

mod tipping;
mod balance;
mod bounty;
mod admin;
mod views;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Balances,
    BountyDeposits,
}

/// Stored bounty info: who created it, how much, and when it expires.
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct BountyInfo {
    pub requester: AccountId,
    pub amount: u128,
    pub expires_at_ns: u64, // nanosecond timestamp
}

/// 30 days in nanoseconds
pub const BOUNTY_DURATION_NS: u64 = 30 * 24 * 60 * 60 * 1_000_000_000;

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
#[borsh(crate = "near_sdk::borsh")]
pub struct NearFmContract {
    pub owner: AccountId,
    pub commission_rate_bps: u16,
    pub total_commission_collected: u128,
    pub withdrawal_penalty_bps: u16,
    pub balances: LookupMap<AccountId, u128>,
    pub bounty_deposits: LookupMap<String, BountyInfo>,
}

#[near_bindgen]
impl NearFmContract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            commission_rate_bps: 500, // 5%
            total_commission_collected: 0,
            withdrawal_penalty_bps: 2000, // 20%
            balances: LookupMap::new(StorageKey::Balances),
            bounty_deposits: LookupMap::new(StorageKey::BountyDeposits),
        }
    }

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "Owner only"
        );
    }

    fn apply_commission(&mut self, amount: u128) -> (u128, u128) {
        let commission = amount * self.commission_rate_bps as u128 / 10_000;
        let net = amount - commission;
        self.total_commission_collected += commission;
        (net, commission)
    }
}
