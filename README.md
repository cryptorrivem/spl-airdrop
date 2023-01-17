# SPL airdrop tool

Send SOL and SPL tokens from a wallet to many wallets, enabling to thaw/freeze upon sending.

## Requirements

- Node 16+

Have all the SOL/SPL in a wallet, use the keypair to sign and pay for fees. The tool will do the required checks, create token accounts on receiver wallet (if required) and freeze/thaw when specified.

## Setup

`npm install`

## Recomendations

- Use a fresh keypair, would avoid other transactions happening that can affect the verification step. Not a requirement, but a recommendation.
- Use a custom RPC to send these, increases the chances to succeed.

## Building recipients list file

You can create either a JSON, CSV or TSV file with 3 properties:

- Recipient (Solana wallet)
- Address (SPL mint address or "SOL" for sending SOL)
- Amount (decimal value, the tool handles the lamports conversion)

## Airdrop SOL/SPL

Ensure to have enough SOL/SPL tokens in the keypair specified according to what amounts were written in the list file. SPL tokens might require creating token accounts that cost 0.0204 SOL each (paid by the keypair wallet).

```
Usage: node airdrop.js send [options]

Options:
    -k, --keypair <path>    keypair for wallet holding the SOL to send
    -r, --rpc <string>      rpc to use
    -l, --list <path>       json, csv or tsv file containing the recipients
    -f, --freeze            SPL only, freeze token account after sending, keypair must be the freeze authority for the mint
```

## Verify airdrop

After the airdrop finishes, you can check which transactions went through and obtain the list of pending. Allow a couple minutes before the other process ends, to ensure the transactions reached the `confirmed` commit phase. Use the same rpc as the send (when possible) to ensure you're getting the latest info from what you've sent.

This process will obtain and parse all the transactions that were sent from the keypair used.

> Currently, the process can only manage up to 100 airdrops, need to work on obtaining more of them to avoid rpc rate limiting.

```
Usage: node aidrop.js sent [options]

Options:
    -k, --keypair <path>    keypair for wallet holding the SOL to send
    -r, --rpc <string>      rpc to use
    -l, --list <path>       json, csv or tsv file containing what should have been sent
    -c, --count <int>       Number of last transactions for the keypair to consider. This is important if you have reused the wallet to past airdrops, ideally, you could use the list size for this value
    -s, --sent-list <path>  output file with the amount each wallet has received
    -o, --output <path>     output file with the pending balances to be sent, in the format of the extension (json, csv or tsv)
```

> Take note on the `count` option, such value can drift from what was sent vs what should've sent, as there's no way to tell for the process to know which transactions succeded (from the send) and what others are from previous airdrops (or even deposits for the setup for the current airdrop).
