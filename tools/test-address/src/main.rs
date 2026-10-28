use rand::RngCore;
use zcash_keys::keys::{ReceiverRequirement::{Omit, Require}, UnifiedAddressRequest, UnifiedSpendingKey};
use zcash_protocol::consensus::MainNetwork;
use zip32::AccountId;

fn main() {
    // A throwaway seed from the operating system's generator. It exists only in this process and is dropped on exit: it is never
    // printed, logged or written anywhere, so the resulting address can receive but nobody can ever spend from it.
    let mut seed = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    let usk = UnifiedSpendingKey::from_seed(&MainNetwork, &seed, AccountId::ZERO).expect("derive account");
    let ufvk = usk.to_unified_full_viewing_key();
    let (ua, _) = ufvk
        .default_address(UnifiedAddressRequest::custom(Require, Require, Omit).expect("shielded-only request"))
        .expect("derive address");
    println!("{}", ua.encode(&MainNetwork));
}
