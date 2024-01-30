#!/usr/bin/env node

import fs from "node:fs";
import yargs from "yargs";
import { MachineLoginMethod, PodAndOwnerInfo } from "../common/interfaces.js";
import { hideBin } from "yargs/helpers";
import { DumpType } from "../solid/auth-fetch-cache";
import { UserToken } from "../solid/solid-auth";

function main(): number {
  const argv = yargs(hideBin(process.argv))
    .usage("$0 <auth-cache.json file 1> <auth-cache.json file 2> ...")
    .demandCommand(2)
    .help()
    .parseSync();
  let curIndex = 0;
  const output: DumpType = {
    timestamp: new Date().toISOString(),
    cssTokensByUser: {},
    authAccessTokenByUser: {},
    filename: "/tmp/dummy",
  };
  for (const filename of argv._) {
    const fileContent = fs.readFileSync(filename, { encoding: "utf8" });
    const authCacheDump: DumpType = JSON.parse(fileContent);
    for (const [user, userToken] of Object.entries(
      authCacheDump.cssTokensByUser
    )) {
      output.cssTokensByUser[user] = userToken;
    }
    for (const [user, authAccessToken] of Object.entries(
      authCacheDump.authAccessTokenByUser
    )) {
      output.authAccessTokenByUser[user] = authAccessToken;
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
