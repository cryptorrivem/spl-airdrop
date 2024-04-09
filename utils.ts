import fs from "fs";
import { TSV, CSV } from "tsv";

export const SOL_ADDRESS = "SOL";
export const SOL_DECIMALS = 9;

export function getExtension(file: string) {
  return file.substring(file.lastIndexOf(".") + 1);
}

export type Airdrop = {
  recipient: string;
  address: string;
  amount: number;
};

function readFile(file: string): (Airdrop & { amount: string })[] {
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
  throw new Error("Unsupported file");
}

export function readListFile(file: string) {
  const rows = readFile(file);
  return rows.map(({ recipient, address, amount }) => ({
    recipient,
    address,
    amount: parseFloat(amount),
  }));
}

function writeFile(file: string, data: any) {
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
    default:
      throw new Error("Unsupported file");
  }
  fs.writeFileSync(file, text, "utf-8");
}

export function writeListFile(
  file: string,
  list: Record<string, { amount: number; tokenAddress: string }[]>
) {
  const data = Object.keys(list).reduce<Airdrop[]>(
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
  return data;
}

export function batch<T>(array: T[], size: number): T[][] {
  let result: T[][] = [];
  while (array.length > 0) {
    result = [...result, array.slice(0, size)];
    array = array.slice(size);
  }
  return result;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
