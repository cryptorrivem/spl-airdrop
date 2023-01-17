const { SOL_ADDRESS, SOL_DECIMALS } = require("./utils");

function parseTransaction(hash, tx) {
  if (!tx) {
    return { hash, notFound: true, transfers: [] };
  }
  const {
    meta: { postTokenBalances },
    transaction: {
      message: { accountKeys, instructions },
    },
  } = tx;
  return {
    hash,
    valid: true,
    confirmed: true,
    transfers: instructions.reduce((res, { program, parsed }) => {
      if (!parsed) {
        return res;
      }
      const { type, info } = parsed;
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
          const tokenInfo = postTokenBalances.find(
            (t) => t.accountIndex === accountIx
          );
          return [
            ...res,
            {
              from: info.authority,
              to: tokenInfo.owner,
              tokenAddress: tokenInfo.mint,
              amount: parseInt(info.amount),
              decimals: tokenInfo.uiTokenAmount.decimals,
            },
          ];
        }
      }
      return res;
    }, []),
  };
}

async function getTransactions({ connection, address, count }) {
  const limit = 1000;
  let transactions = [];
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
      finality
    );
    const validTransactions = result
      .map((tx, ix) => parseTransaction(signatures[ix].signature, tx))
      .filter((tx) => tx.valid);
    transactions = [...transactions, ...validTransactions];
    if (result.length > 0) {
      beforeHash = result[result.length - 1].hash;
    }

    if (result.length < limit || result.some((r) => r.hash === newerThanHash)) {
      break;
    }
  } while (true);

  return transactions;
}

module.exports = {
  getTransactions,
};
