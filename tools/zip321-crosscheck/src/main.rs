// Reads one ZIP 321 URI per line on stdin and prints, per line, either
//   OK <index> <address> <amount_zatoshis|-> <memo_hex|->  (one line per payment, tab separated)
// or
//   ERR <message>
// The parser is the reference `zip321` crate from librustzcash. No network, no keys, no wallet.
use std::io::{self, BufRead};
use zip321::TransactionRequest;

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let uri = line.expect("stdin");
        let uri = uri.trim();
        if uri.is_empty() {
            continue;
        }
        match TransactionRequest::from_uri(uri) {
            Ok(request) => {
                let mut any = false;
                for (index, payment) in request.payments() {
                    any = true;
                    let memo = payment
                        .memo()
                        .map(|m| m.as_array().iter().map(|b| format!("{:02x}", b)).collect::<String>())
                        .unwrap_or_else(|| "-".to_string());
                    println!(
                        "OK\t{}\t{}\t{}\t{}",
                        index,
                        payment.recipient_address().encode(),
                        payment.amount().map(|a| u64::from(a).to_string()).unwrap_or_else(|| "-".to_string()),
                        memo
                    );
                }
                if !any {
                    println!("ERR no payments");
                }
            }
            Err(e) => println!("ERR\t{}", e),
        }
    }
}
