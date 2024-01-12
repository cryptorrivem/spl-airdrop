const {
  web3: { PublicKey, SystemProgram, LAMPORTS_PER_SOL },
} = require("@project-serum/anchor");
const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const { VersionedTransaction, TransactionMessage } = require("@solana/web3.js");
const { PromisePool } = require("@supercharge/promise-pool");
const { SOL_ADDRESS } = require("./utils");

async function canSend({ connection, wallet, recipients }) {
  const [balance, { value: tokenBalances }] = await Promise.all([
    connection.getBalance(wallet.publicKey),
    connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    }),
  ]);
  const requiredBalances = recipients.reduce(
    (res, { address, amount }) => ({
      ...res,
      [address]: (res[address] || 0) + amount,
    }),
    { SOL: 0 }
  );
  let tokenAccountWallets = recipients.reduce(
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

function batch(array, size) {
  let result = [];
  while (array.length > 0) {
    result = [...result, array.slice(0, size)];
    array = array.slice(size);
  }
  return result;
}

async function sendAll({
  simulate,
  connection,
  wallet,
  recipients,
  rateLimit,
  bundleSize,
  decimals,
}) {
  await canSend({ connection, wallet, recipients });

  const batches = batch(recipients, bundleSize);
  await PromisePool.for(batches)
    .withConcurrency(rateLimit)
    .handleError((err) => {
      console.error(err);
    })
    .process(async (recipients) => {
      let instructions = [];
      for (const { recipient, address, amount } of recipients) {
        if (address === SOL_ADDRESS) {
          instructions.push(
            ...(await sendSOLInstructions({
              from: wallet.publicKey,
              recipient,
              amount,
            }))
          );
        } else {
          instructions.push(
            ...(await sendSPLInstructions({
              connection,
              from: wallet.publicKey,
              recipient,
              address,
              amount,
              decimals: decimals[address],
            }))
          );
        }
      }

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      const message = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions,
      });
      const transaction = new VersionedTransaction(
        message.compileToV0Message()
      );

      try {
        if (simulate) {
          const { value } = await connection.simulateTransaction(transaction);
          const success = !value.err;
          console.info(recipients, "=>", success);
        } else {
          transaction.sign([wallet]);
          const signature = await connection.sendTransaction(transaction, {
            maxRetries: 2,
          });
          await connection.confirmTransaction(
            { signature, blockhash, lastValidBlockHeight },
            "processed"
          );
          console.info(recipients, "=>", signature);
        }
      } catch (err) {
        console.error(recipients, "Error sending", err);
      }
    });
}

async function sendSOLInstructions({ from, recipient, amount }) {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: new PublicKey(recipient),
      lamports: Math.round(amount * LAMPORTS_PER_SOL),
    }),
  ];
}

async function sendSPLInstructions({
  connection,
  from,
  recipient,
  address,
  amount,
  decimals,
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

  const { value: exist } = await connection.getParsedAccountInfo(
    recipientTokenAccount
  );
  if (!exist) {
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

module.exports = {
  sendAll,
};
