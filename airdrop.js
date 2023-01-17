const fs = require("fs");
const {
  web3: { Connection, Keypair },
} = require("@project-serum/anchor");
const { clusterApiUrl, PublicKey } = require("@solana/web3.js");
const { Command } = require("commander");
const {
  readListFile,
  writeListFile,
  SOL_ADDRESS,
  SOL_DECIMALS,
  getExtension,
} = require("./utils");
const sent = require("./sent");
const { sendAll } = require("./send");
const program = new Command();

program.name("airdrop").description("Custom airdrop tool");

function getConnection({ rpc, env }) {
  return new Connection(rpc || clusterApiUrl(env), {
    confirmTransactionInitialTimeout: 90000,
  });
}
function getKeypair(file) {
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(file)))
  );
}

program
  .command("send")
  .description("Send from keypair wallet to recipients from list")
  .requiredOption("-k, --keypair <path>", "keypair to send from")
  .option("-r, --rpc <string>", "rpc to use")
  .option("-e, --env <string>", "environment to use")
  .requiredOption(
    "-l, --list <path>",
    "list tsv file containing recipients and amounts"
  )
  .option("-rl, --rate-limit <number>", "concurrent transactions", 5)
  .action(({ keypair, rpc, env, list, rateLimit }) => {
    const connection = getConnection({ rpc, env });
    const wallet = getKeypair(keypair);
    const recipients = readListFile(list);

    (async function () {
      const addresses = Array.from(
        new Set(recipients.map((r) => r.address))
      ).filter((a) => a !== SOL_ADDRESS);
      let decimals = { [SOL_ADDRESS]: SOL_DECIMALS };
      if (addresses.length > 0) {
        const infos = await Promise.all(
          addresses.map((a) =>
            connection.getParsedAccountInfo(new PublicKey(a))
          )
        );
        decimals = infos.reduce(
          (res, i, ix) => ({
            ...res,
            [addresses[ix]]: i.value.data.parsed.info.decimals,
          }),
          decimals
        );
      }

      await sendAll({ connection, wallet, recipients, rateLimit, decimals });
    })();
  });

program
  .command("sent")
  .description(
    "Get transactions sent from the keypair wallet and output the pending list"
  )
  .requiredOption("-k, --keypair <path>", "keypair to send from")
  .option("-r, --rpc <string>", "rpc to use")
  .option("-e, --env <string>", "environment to use")
  .requiredOption(
    "-l, --list <path>",
    "list tsv file containing recipients and amounts that should've been sent"
  )
  .requiredOption(
    "-s, --sent-list <path>",
    "amounts sent per user in list tsv file format"
  )
  .requiredOption(
    "-o, --output <path>",
    "list tsv file containing recipients and amounts pending"
  )
  .option("-c, --count <int>", "last nth transactions")
  .action(({ keypair, rpc, env, list, sentList, output, count }) => {
    (async function () {
      const connection = getConnection({ rpc, env });
      const address = getKeypair(keypair).publicKey;
      const recipients = readListFile(list);

      count = parseInt(count);
      if (!count) {
        count = recipients.length;
      }

      const alreadySent = await sent({
        connection,
        address,
        count,
        recipients,
      });
      writeListFile(sentList, alreadySent);
      fs.writeFileSync(
        sentList.replace(getExtension(sentList), "json"),
        JSON.stringify(alreadySent, null, 2),
        "utf-8"
      );

      const pending = recipients
        .map(({ recipient, address, amount }) => {
          const sent = (
            alreadySent[recipient] || [{ tokenAddress: address, amount: 0 }]
          ).find((s) => s.tokenAddress === address);
          return {
            recipient,
            tokenAddress: sent.tokenAddress,
            hash: sent.hash,
            amount: amount - sent.amount,
          };
        })
        .filter((p) => p.amount > 1e-8)
        .reduce(
          (res, { recipient, tokenAddress, hash, amount }) => ({
            ...res,
            [recipient]: [
              ...(res[recipient] || []),
              { hash, tokenAddress, amount },
            ],
          }),
          {}
        );
      if (Object.keys(pending).length === 0) {
        console.info("All sent!");
      } else {
        writeListFile(output, pending);
      }
    })();
  });

program.parse();
