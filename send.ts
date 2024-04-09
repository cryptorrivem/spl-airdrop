import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import PromisePool from "@supercharge/promise-pool";
import { Airdrop, SOL_ADDRESS, batch, sleep } from "./utils";

async function canSend({
  connection,
  wallet,
  recipients,
}: {
  connection: Connection;
  wallet: Keypair;
  recipients: Airdrop[];
}) {
  const [balance, { value: tokenBalances }] = await Promise.all([
    connection.getBalance(wallet.publicKey),
    connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    }),
  ]);
  const requiredBalances = recipients.reduce<Record<string, number>>(
    (res, { address, amount }) => ({
      ...res,
      [address]: (res[address] || 0) + amount,
    }),
    { SOL: 0 }
  );
  let tokenAccountWallets = recipients.reduce<PublicKey[]>(
    (res, { address, recipient }) =>
      address === "SOL"
        ? res
        : [
            ...res,
            getAssociatedTokenAddressSync(
              new PublicKey(address),
              new PublicKey(recipient),
              true
            ),
          ],
    []
  );
  while (tokenAccountWallets.length > 0) {
    const sublist = tokenAccountWallets.splice(0, 100);
    const accounts = await connection.getMultipleAccountsInfo(sublist);
    requiredBalances["SOL"] += accounts.filter((a) => !a).length * 0.00204;
  }

  Object.entries(requiredBalances).forEach(([address, amount]) => {
    console.info(
      `Need ${amount} of ${address} to send in ${wallet.publicKey.toBase58()}.`
    );
    if (address === "SOL") {
      if (balance / LAMPORTS_PER_SOL < amount) {
        throw new Error(
          `Found only ${balance} of ${amount} tokens for ${address} in wallet.`
        );
      }
    } else {
      const tokenAccount = tokenBalances.find(
        (t) => t.account.data.parsed?.info.mint === address
      );
      if (!tokenAccount) {
        throw new Error(`No token account for ${address} found in wallet.`);
      }
      const balance =
        tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
      if (balance < amount) {
        throw new Error(
          `Found only ${balance} of ${amount} tokens for ${address} in wallet.`
        );
      }
    }
  });
}

async function getExistingTokenAccounts(
  recipients: Airdrop[],
  connection: Connection
) {
  const tokenAccountAddresses = recipients.reduce<PublicKey[]>(
    (res, { recipient, address }) =>
      address !== SOL_ADDRESS
        ? [
            ...res,
            getAssociatedTokenAddressSync(
              new PublicKey(address),
              new PublicKey(recipient),
              true
            ),
          ]
        : res,
    []
  );
  const batches = batch(tokenAccountAddresses, 100);
  const { results } = await PromisePool.for(batches)
    .withConcurrency(5)
    .process(() => connection.getMultipleAccountsInfo(tokenAccountAddresses));
  const tokenAccounts = results.flat();
  const existingTokenAccounts = tokenAccountAddresses.reduce<
    Record<string, boolean>
  >((res, t, ix) => ({ ...res, [t.toBase58()]: !!tokenAccounts[ix] }), {});
  return existingTokenAccounts;
}

export async function sendAll({
  simulate,
  connection,
  wallet,
  recipients,
  priorityFees,
  rateLimit,
  bundleSize,
  decimals,
}: {
  simulate: boolean;
  connection: Connection;
  wallet: Keypair;
  recipients: Airdrop[];
  priorityFees: number;
  rateLimit: number;
  bundleSize: number;
  decimals: Record<string, number>;
}) {
  await canSend({ connection, wallet, recipients });
  const existingTokenAccounts = await getExistingTokenAccounts(
    recipients,
    connection
  );

  const batches = batch(recipients, bundleSize);
  await PromisePool.for(batches)
    .withConcurrency(rateLimit)
    .handleError((err) => {
      console.error(err);
    })
    .process(async (recipients) => {
      let units = 0;
      let instructions = [];
      for (const { recipient, address, amount } of recipients) {
        if (address === SOL_ADDRESS) {
          instructions.push(
            ...sendSOLInstructions({
              from: wallet.publicKey,
              recipient,
              amount,
            })
          );
          units += 200;
        } else {
          const splInstructions = sendSPLInstructions({
            from: wallet.publicKey,
            recipient,
            address,
            amount,
            decimals: decimals[address],
            existingTokenAccounts,
          });
          instructions.push(...splInstructions);
          units += splInstructions.length === 2 ? 30000 : 6000;
        }
      }
      instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityFees,
        })
      );

      // for (let attempt = 0; attempt < 1; attempt++) {
      //   try {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("finalized");
      const message = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions,
      });
      const transaction = new VersionedTransaction(
        message.compileToV0Message()
      );

      transaction.sign([wallet]);
      if (simulate) {
        const { value } = await connection.simulateTransaction(transaction);
        if (value.err) {
          throw value.err;
        } else {
          console.info(recipients, "=>", true);
        }
      } else {
        const signature = await connection.sendTransaction(transaction, {
          maxRetries: 0,
        });

        const result = { end: false };
        try {
          await Promise.race([
            connection.confirmTransaction(
              { signature, blockhash, lastValidBlockHeight },
              "confirmed"
            ),
            new Promise<void>(async (resolve) => {
              while (!result.end) {
                await sleep(2000);
                await connection.sendTransaction(transaction, {
                  maxRetries: 0,
                  skipPreflight: true,
                });
              }
              resolve();
            }),
          ]);
          console.info(recipients, "=>", signature);
        } catch (err) {
          console.error(err);
        } finally {
          result.end = true;
        }
        // break;
      }
      //   } catch (err) {
      //     console.error(recipients, "Error sending", err);
      //     if (err instanceof Error && isSimulationError(err)) {
      //       continue;
      //     } else {
      //       break;
      //     }
      //   }
      // }
    });
}

function sendSOLInstructions({
  from,
  recipient,
  amount,
}: {
  from: PublicKey;
  recipient: string;
  amount: number;
}) {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: new PublicKey(recipient),
      lamports: Math.round(amount * LAMPORTS_PER_SOL),
    }),
  ];
}

function sendSPLInstructions({
  from,
  recipient,
  address,
  amount,
  decimals,
  existingTokenAccounts,
}: {
  from: PublicKey;
  recipient: string;
  address: string;
  amount: number;
  decimals: number;
  existingTokenAccounts: Record<string, boolean>;
}) {
  const recipientPubkey = new PublicKey(recipient);
  const mint = new PublicKey(address);
  const fromTokenAccount = getAssociatedTokenAddressSync(mint, from);
  const recipientTokenAccount = getAssociatedTokenAddressSync(
    mint,
    recipientPubkey,
    true
  );
  let result = [];

  if (!existingTokenAccounts[recipientTokenAccount.toBase58()]) {
    result.push(
      createAssociatedTokenAccountInstruction(
        from,
        recipientTokenAccount,
        recipientPubkey,
        mint
      )
    );
  }
  result.push(
    createTransferInstruction(
      fromTokenAccount,
      recipientTokenAccount,
      from,
      Math.round(amount * 10 ** decimals)
    )
  );

  return result;
}
