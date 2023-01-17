const { getTransactions } = require("./solana");

module.exports = async function ({ connection, address, recipients, count }) {
  const transactions = await getTransactions({
    connection,
    address,
    count,
  });
  const transfers = transactions
    .filter(({ hash, transfers }, ix) => {
      const result = transfers.filter(
        (tf) =>
          tf.from === address.toBase58() &&
          recipients.some(
            (r) => r.recipient === tf.to && r.address === tf.tokenAddress
          )
      );
      if (result.length === 0) {
        console.info("ignoring #", ix, hash, transfers);
      }
      return result.length > 0;
    })
    .reduce(
      (res, { hash, transfers }) =>
        transfers.reduce(
          (res, { to, tokenAddress, amount, decimals }) => ({
            ...res,
            [to]: [
              ...(res[to] || []),
              {
                hash,
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
};
