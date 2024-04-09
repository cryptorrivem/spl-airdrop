import { Connection, PublicKey } from "@solana/web3.js";
import { getTransactions } from "./solana";
import { Airdrop } from "./utils";

interface SentParams {
  connection: Connection;
  address: PublicKey;
  recipients: Airdrop[];
  count: number;
}

export type Sent = Record<
  string,
  { hash: string[]; tokenAddress: string; amount: number }[]
>;

export default async function sent({
  connection,
  address,
  recipients,
  count,
}: SentParams) {
  const transactions = await getTransactions({
    connection,
    address,
    count,
  });
  const transfers = transactions
    .filter(({ hash, transfers, signers }, ix) => {
      const result = transfers.filter(
        (tf) =>
          tf.from === address.toBase58() &&
          recipients.some(
            (r) => r.recipient === tf.to && r.address === tf.tokenAddress
          )
      );
      if (result.length === 0) {
        console.info("ignoring #", ix, hash, transfers, signers);
      }
      return result.length > 0;
    })
    .reduce<Sent>(
      (res, { hash, transfers }) =>
        transfers.reduce<Sent>(
          (res, { to, tokenAddress, amount, decimals }) => ({
            ...res,
            [to]: [
              ...(res[to] || []),
              {
                hash: [hash!],
                tokenAddress,
                amount: amount / 10 ** decimals,
              },
            ],
          }),
          res
        ),
      {}
    );

  return transfers;
}
