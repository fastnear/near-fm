use near_sdk::{env, log, near_bindgen, AccountId, NearToken, Promise};
use near_sdk::json_types::U128;

use crate::{BountyInfo, NearFmContract, NearFmContractExt};

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

        self.bounty_deposits.insert(
            &request_uuid,
            &BountyInfo {
                requester: requester.clone(),
                amount: deposit,
            },
        );

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"bounty_created\",\"data\":[{{\"requester\":\"{}\",\"amount\":\"{}\",\"request_uuid\":\"{}\"}}]}}",
            requester, deposit, request_uuid
        );
    }

    /// Award bounty to a song uploader. Only the original requester can call this.
    pub fn award_bounty(&mut self, request_uuid: String, recipient: AccountId) -> Promise {
        let caller = env::predecessor_account_id();
        let info = self
            .bounty_deposits
            .remove(&request_uuid)
            .expect("No bounty found for this request");

        assert_eq!(caller, info.requester, "Only the requester can award");

        let (award_amount, commission) = self.apply_commission(info.amount);

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"bounty_awarded\",\"data\":[{{\"requester\":\"{}\",\"recipient\":\"{}\",\"amount\":\"{}\",\"commission\":\"{}\",\"request_uuid\":\"{}\"}}]}}",
            caller, recipient, award_amount, commission, request_uuid
        );

        Promise::new(recipient).transfer(NearToken::from_yoctonear(award_amount))
    }

    /// Withdraw bounty (with penalty). Only the requester can withdraw.
    pub fn withdraw_bounty(&mut self, request_uuid: String) -> Promise {
        let caller = env::predecessor_account_id();
        let info = self
            .bounty_deposits
            .remove(&request_uuid)
            .expect("No bounty found for this request");

        assert_eq!(caller, info.requester, "Only the requester can withdraw");

        let penalty = info.amount * self.withdrawal_penalty_bps as u128 / 10_000;
        let refund = info.amount - penalty;
        self.total_commission_collected += penalty;

        log!(
            "EVENT_JSON:{{\"standard\":\"nearfm\",\"version\":\"1.0.0\",\"event\":\"bounty_withdrawn\",\"data\":[{{\"requester\":\"{}\",\"refund\":\"{}\",\"penalty\":\"{}\",\"request_uuid\":\"{}\"}}]}}",
            caller, refund, penalty, request_uuid
        );

        Promise::new(caller).transfer(NearToken::from_yoctonear(refund))
    }
}
