import {
  Connection,
  PublicKey,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  SendTransactionError,
} from "@solana/web3.js";
import { SOL_ADDRESS, SOL_DECIMALS } from "./utils";

export type ParsedTransfer = {
  from: string;
  to: string;
  tokenAddress: string;
  amount: number;
  decimals: number;
};
export type ParsedTransaction = {
  hash?: string;
  valid?: boolean;
  notFound?: boolean;
  signers: string[];
  transfers: ParsedTransfer[];
};

function parseTransaction(tx: ParsedTransactionWithMeta) {
  if (!tx) {
    return { notFound: true, signers: [], transfers: [] };
  }
  const {
    meta,
    transaction: {
      message: { accountKeys, instructions },
      signatures,
    },
  } = tx;
  return {
    hash: signatures[0],
    valid: !meta?.err,
    signers: tx.transaction.message.accountKeys
      .filter((a) => a.signer)
      .map((a) => a.pubkey.toBase58()),
    transfers: instructions.reduce<ParsedTransfer[]>((res, i) => {
      if (!(i as ParsedInstruction).parsed) {
        return res;
      }
      const {
        parsed: { type, info },
        program,
      } = i as ParsedInstruction;
      if (type === "transfer") {
        if (program === "system") {
          return [
            ...res,
            {
              from: info.source,
              to: info.destination,
              tokenAddress: SOL_ADDRESS,
              amount: info.lamports,
              decimals: SOL_DECIMALS,
            },
          ];
        } else if (program === "spl-token") {
          const accountIx = accountKeys.findIndex(
            (a) => a.pubkey.toBase58() === info.destination
          );
          const tokenInfo =
            meta!.postTokenBalances!.find(
              (t) => t.accountIndex === accountIx
            ) ||
            meta!.preTokenBalances!.find((t) => t.accountIndex === accountIx);
          return [
            ...res,
            {
              from: info.authority,
              to: tokenInfo!.owner,
              tokenAddress: tokenInfo!.mint,
              amount: parseInt(info.amount),
              decimals: tokenInfo!.uiTokenAmount.decimals,
            },
          ];
        }
      }
      return res;
    }, []),
  };
}

export async function getTransactions({
  connection,
  address,
  count,
  newerThanHash,
}: {
  connection: Connection;
  address: PublicKey;
  count: number;
  newerThanHash?: string;
}) {
  const limit = 1000;
  let transactions: ParsedTransaction[] = [];
  let beforeHash = "";
  const finality = "confirmed";
  do {
    const signatures = await connection.getSignaturesForAddress(
      address,
      { limit: count },
      finality
    );
    const result = await connection.getParsedTransactions(
      signatures.map((s) => s.signature),
      {
        commitment: finality,
        maxSupportedTransactionVersion: 0,
      }
    );
    const validTransactions = result
      .map((tx) => parseTransaction(tx!))
      .filter((tx) => tx.valid);
    transactions = [...transactions, ...validTransactions];
    if (result.length > 0) {
      beforeHash = result[result.length - 1]?.transaction.signatures[0] || "";
    }

    if (
      !beforeHash ||
      result.length < limit ||
      result.some((r) => r?.transaction.signatures[0] === newerThanHash)
    ) {
      break;
    }
  } while (true);

  return transactions;
}

export function isSimulationError(err: Error) {
  return (
    err instanceof SendTransactionError &&
    err.message.includes("Transaction simulation failed")
  );
}
