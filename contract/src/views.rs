use near_sdk::{near_bindgen, AccountId};
use near_sdk::json_types::U128;

use crate::{BountyInfo, NearFmContract, NearFmContractExt};

#[near_bindgen]
impl NearFmContract {
    pub fn get_commission_rate(&self) -> u16 {
        self.commission_rate_bps
    }

    pub fn get_withdrawal_penalty(&self) -> u16 {
        self.withdrawal_penalty_bps
    }

    pub fn get_total_commission(&self) -> U128 {
        U128(self.total_commission_collected)
    }

    pub fn get_bounty_deposit(&self, request_uuid: String) -> Option<(AccountId, U128, U128)> {
        self.bounty_deposits
            .get(&request_uuid)
            .map(|info| (info.requester, U128(info.amount), U128(info.expires_at_ns as u128)))
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}
