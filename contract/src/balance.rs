use near_sdk::{env, log, near_bindgen, AccountId, NearToken, Promise};
use near_sdk::json_types::U128;

use crate::{NearFmContract, NearFmContractExt};

#[near_bindgen]
impl NearFmContract {
    /// Deposit NEAR into virtual balance.
    #[payable]
    pub fn deposit(&mut self) {
        let account = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "Must attach NEAR to deposit");

        let current = self.balances.get(&account).unwrap_or(0);
        self.balances.insert(&account, &(current + amount));

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"deposit\",\"data\":[{{\"account\":\"{}\",\"amount\":\"{}\",\"new_balance\":\"{}\"}}]}}",
            account, amount, current + amount
        );
    }

    /// Withdraw NEAR from virtual balance.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let account = env::predecessor_account_id();
        let amount = amount.0;
        let current = self.balances.get(&account).unwrap_or(0);
        assert!(current >= amount, "Insufficient balance");

        self.balances.insert(&account, &(current - amount));

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"withdraw\",\"data\":[{{\"account\":\"{}\",\"amount\":\"{}\",\"new_balance\":\"{}\"}}]}}",
            account, amount, current - amount
        );

        Promise::new(account).transfer(NearToken::from_yoctonear(amount))
    }

    /// View: get virtual balance for an account.
    pub fn get_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).unwrap_or(0))
    }
}
