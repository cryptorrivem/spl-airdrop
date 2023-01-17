const fs = require("fs");
const { TSV, CSV } = require("tsv");

const SOL_ADDRESS = "SOL";
const SOL_DECIMALS = 9;

function getExtension(file) {
  return file.substring(file.lastIndexOf(".") + 1);
}

function readFile(file) {
  const extension = getExtension(file);
  const text = fs.readFileSync(file, "utf-8");
  switch (extension) {
    case "tsv":
      return TSV.parse(text);
    case "csv":
      return CSV.parse(text);
    case "json":
      return JSON.parse(text);
  }
}

function readListFile(file) {
  const rows = readFile(file);
  return rows.map(({ recipient, address, amount }) => ({
    recipient,
    address,
    amount: parseFloat(amount),
  }));
}

function writeFile(file, data) {
  const extension = getExtension(file);
  let text;
  switch (extension) {
    case "tsv":
      text = TSV.stringify(data);
      break;
    case "csv":
      text = CSV.stringify(data);
      break;
    case "json":
      text = JSON.stringify(data, null, 2);
      break;
  }
  fs.writeFileSync(file, text, "utf-8");
}

function writeListFile(file, list) {
  const data = Object.keys(list).reduce(
    (res, recipient) => [
      ...res,
      ...list[recipient].map(({ amount, tokenAddress }) => ({
        recipient,
        address: tokenAddress,
        amount,
      })),
    ],
    []
  );
  writeFile(file, data);
}

module.exports = {
  SOL_ADDRESS,
  SOL_DECIMALS,
  getExtension,
  readListFile,
  writeListFile,
};
