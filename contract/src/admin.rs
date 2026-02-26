use near_sdk::{env, near_bindgen, NearToken, Promise};

use crate::{NearFmContract, NearFmContractExt};

#[near_bindgen]
impl NearFmContract {
    pub fn set_commission_rate(&mut self, rate_bps: u16) {
        self.assert_owner();
        assert!(rate_bps <= 5000, "Commission cannot exceed 50%");
        self.commission_rate_bps = rate_bps;
    }

    pub fn set_withdrawal_penalty(&mut self, penalty_bps: u16) {
        self.assert_owner();
        assert!(penalty_bps <= 5000, "Penalty cannot exceed 50%");
        self.withdrawal_penalty_bps = penalty_bps;
    }

    pub fn withdraw_commission(&mut self) -> Promise {
        self.assert_owner();
        let amount = self.total_commission_collected;
        assert!(amount > 0, "No commission to withdraw");
        self.total_commission_collected = 0;
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount))
    }

    pub fn set_owner(&mut self, new_owner: near_sdk::AccountId) {
        self.assert_owner();
        self.owner = new_owner;
    }
}
