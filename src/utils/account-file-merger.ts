#!/usr/bin/env node

import fs from "node:fs";
import yargs from "yargs";
import { MachineLoginMethod, PodAndOwnerInfo } from "../common/interfaces.js";
import { hideBin } from "yargs/helpers";

function main(): number {
  const argv = yargs(hideBin(process.argv))
    .usage("$0 <account.json file 1> <account.json file 2> ...")
    .demandCommand(2)
    .help()
    .parseSync();
  let curIndex = 0;
  const output = [];
  for (const filename of argv._) {
    const fileContent = fs.readFileSync(filename, { encoding: "utf8" });
    const accounts = JSON.parse(fileContent);
    for (const account of accounts) {
      const podAndOwnerInfo = <PodAndOwnerInfo>account;
      const newPodAndOwnerInfo: PodAndOwnerInfo = {
        ...podAndOwnerInfo,
        index: curIndex++,
      };
      output.push(newPodAndOwnerInfo);
    }
  }
  process.stdout.write(JSON.stringify(output, null, 3));
  process.stdout.write("\n");
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(err);
  process.exit(1);
}
