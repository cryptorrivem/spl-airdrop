const {
  web3: { PublicKey, SystemProgram, LAMPORTS_PER_SOL },
} = require("@project-serum/anchor");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} = require("@solana/spl-token");
const { Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { PromisePool } = require("@supercharge/promise-pool");
const { SOL_ADDRESS } = require("./utils");

async function sendAll({
  connection,
  wallet,
  recipients,
  rateLimit,
  decimals,
}) {
  await PromisePool.for(recipients)
    .withConcurrency(parseInt(rateLimit))
    .process(async ({ recipient, address, amount }) => {
      let instructions = [];
      if (address === SOL_ADDRESS) {
        instructions = await sendSOLInstructions({
          from: wallet.publicKey,
          recipient,
          amount,
        });
      } else {
        instructions = await sendSPLInstructions({
          connection,
          from: wallet.publicKey,
          recipient,
          address,
          amount,
          decimals: decimals[address],
        });
      }

      const transaction = new Transaction();
      await transaction.add(...instructions);

      try {
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [wallet],
          { commitment: "processed" }
        );
        console.info(recipient, amount, "=>", signature);
        // console.info(recipient, amount, "=>");
      } catch (err) {
        console.error(recipient, amount, "Error sending", err);
      }
    });
}

async function sendSOLInstructions({ from, recipient, amount }) {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: new PublicKey(recipient),
      lamports: Math.floor(amount * LAMPORTS_PER_SOL),
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
  const fromTokenAccount = await getAssociatedTokenAddress(mint, from);
  const recipientTokenAccount = await getAssociatedTokenAddress(
    mint,
    recipientPubkey
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
      Math.floor(amount * 10 ** decimals)
    )
  );

  return result;
}

module.exports = {
  sendAll,
};
