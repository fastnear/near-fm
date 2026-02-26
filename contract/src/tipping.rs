use near_sdk::{env, log, near_bindgen, AccountId, NearToken, Promise};
use near_sdk::json_types::U128;

use crate::{NearFmContract, NearFmContractExt};

#[near_bindgen]
impl NearFmContract {
    /// Send a direct tip (attached NEAR goes to recipient minus commission).
    #[payable]
    pub fn tip(&mut self, recipient: AccountId, song_uuid: String) -> Promise {
        let sender = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit > 0, "Must attach NEAR to tip");

        let (tip_amount, commission) = self.apply_commission(deposit);

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"tip\",\"data\":[{{\"sender\":\"{}\",\"recipient\":\"{}\",\"amount\":\"{}\",\"commission\":\"{}\",\"song_uuid\":\"{}\",\"from_balance\":false}}]}}",
            sender, recipient, tip_amount, commission, song_uuid
        );

        Promise::new(recipient).transfer(NearToken::from_yoctonear(tip_amount))
    }

    /// Tip from virtual balance (callable via function call access key, no wallet popup).
    pub fn tip_from_balance(
        &mut self,
        recipient: AccountId,
        amount: U128,
        song_uuid: String,
    ) {
        let sender = env::predecessor_account_id();
        let amount = amount.0;
        assert!(amount > 0, "Amount must be positive");

        let current = self.balances.get(&sender).unwrap_or(0);
        assert!(current >= amount, "Insufficient balance");

        let (tip_amount, commission) = self.apply_commission(amount);

        // Deduct from sender
        self.balances.insert(&sender, &(current - amount));

        // Add to recipient's balance
        let recipient_balance = self.balances.get(&recipient).unwrap_or(0);
        self.balances.insert(&recipient, &(recipient_balance + tip_amount));

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"tip\",\"data\":[{{\"sender\":\"{}\",\"recipient\":\"{}\",\"amount\":\"{}\",\"commission\":\"{}\",\"song_uuid\":\"{}\",\"from_balance\":true}}]}}",
            sender, recipient, tip_amount, commission, song_uuid
        );
    }
}
