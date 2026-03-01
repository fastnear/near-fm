use near_sdk::{env, log, near_bindgen, AccountId};

use crate::{BountyInfo, NearFmContract, NearFmContractExt, BOUNTY_DURATION_NS};

#[near_bindgen]
impl NearFmContract {
    /// Create a song request bounty. Attached NEAR is held by the contract.
    #[payable]
    pub fn create_bounty(&mut self, request_uuid: String) {
        let requester = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(
            deposit >= 1_000_000_000_000_000_000_000_000,
            "Minimum bounty is 1 NEAR"
        );
        assert!(
            self.bounty_deposits.get(&request_uuid).is_none(),
            "Bounty already exists for this request"
        );

        let expires_at_ns = env::block_timestamp() + BOUNTY_DURATION_NS;

        self.bounty_deposits.insert(
            &request_uuid,
            &BountyInfo {
                requester: requester.clone(),
                amount: deposit,
                expires_at_ns,
            },
        );

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"bounty_created\",\"data\":[{{\"requester\":\"{}\",\"amount\":\"{}\",\"request_uuid\":\"{}\",\"expires_at_ns\":\"{}\"}}]}}",
            requester, deposit, request_uuid, expires_at_ns
        );
    }

    /// Award bounty to a song uploader. Only the original requester can call this.
    /// Award is credited to recipient's virtual balance.
    pub fn award_bounty(&mut self, request_uuid: String, recipient: AccountId) {
        let caller = env::predecessor_account_id();
        let info = self
            .bounty_deposits
            .remove(&request_uuid)
            .expect("No bounty found for this request");

        assert_eq!(caller, info.requester, "Only the requester can award");

        let (award_amount, commission) = self.apply_commission(info.amount);

        // Credit to recipient's virtual balance
        let recipient_balance = self.balances.get(&recipient).unwrap_or(0);
        self.balances.insert(&recipient, &(recipient_balance + award_amount));

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"bounty_awarded\",\"data\":[{{\"requester\":\"{}\",\"recipient\":\"{}\",\"amount\":\"{}\",\"commission\":\"{}\",\"request_uuid\":\"{}\"}}]}}",
            caller, recipient, award_amount, commission, request_uuid
        );
    }

    /// Withdraw bounty (with penalty). Only the requester can withdraw, only after expiry.
    /// Refund (minus penalty) is credited to requester's virtual balance.
    pub fn withdraw_bounty(&mut self, request_uuid: String) {
        let caller = env::predecessor_account_id();
        let info = self
            .bounty_deposits
            .remove(&request_uuid)
            .expect("No bounty found for this request");

        assert_eq!(caller, info.requester, "Only the requester can withdraw");
        assert!(
            env::block_timestamp() >= info.expires_at_ns,
            "Bounty has not expired yet. Withdrawal is only available after the 30-day period."
        );

        let penalty = info.amount * self.withdrawal_penalty_bps as u128 / 10_000;
        let refund = info.amount - penalty;
        self.total_commission_collected += penalty;

        // Credit refund to requester's virtual balance
        let current_balance = self.balances.get(&caller).unwrap_or(0);
        self.balances.insert(&caller, &(current_balance + refund));

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"bounty_withdrawn\",\"data\":[{{\"requester\":\"{}\",\"refund\":\"{}\",\"penalty\":\"{}\",\"request_uuid\":\"{}\"}}]}}",
            caller, refund, penalty, request_uuid
        );
    }
}
