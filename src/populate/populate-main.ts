#!/usr/bin/env node

import { populatePodsFromDir } from "./populate-from-dir.js";
import {
  generateFixedSizeFiles,
  generateRdfFiles,
  generateVariableSizeFiles,
} from "./generate-files.js";
import {
  CreatedUserInfo,
  generateAccountsAndPods,
} from "./generate-account-pod.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { AnyFetchType, es6fetch } from "../utils/generic-fetch.js";
import nodeFetch from "node-fetch";
import { getCliArgs } from "./populate-args.js";
import fs from "fs";
import { readFile } from "node:fs/promises";
import { ProvidedAccountInfo } from "../common/account.js";
import { getAccounts } from "../common/account";
import { AccountAction } from "../common/cli-args";

async function main() {
  const cli = getCliArgs();
  const fetcher: AnyFetchType = false ? nodeFetch : es6fetch;

  const providedAccountInfo: ProvidedAccountInfo[] = await getAccounts(cli);
  const createdUsersInfo: CreatedUserInfo[] = [];

  for (const cssBaseUrl of cli.cssBaseUrl) {
    const authFetchCache = new AuthFetchCache(
      cli,
      providedAccountInfo,
      cssBaseUrl,
      true,
      "all",
      fetcher
    );

    if (cli.accountAction != AccountAction.UseExisting) {
      //TODO handle Auto and Create differently
      await generateAccountsAndPods(
        cli,
        cssBaseUrl,
        authFetchCache,
        providedAccountInfo,
        createdUsersInfo
      );
    }

    if (cli.generateVariableSize) {
      await generateVariableSizeFiles(
        authFetchCache,
        cli,
        cssBaseUrl,
        providedAccountInfo,
        cli.addAclFiles,
        cli.addAcrFiles,
        cli.addAcFilePerResource,
        cli.addAcFilePerDir,
        cli.dirDepth
      );
    }

    if (cli.generateFixedSize) {
      await generateFixedSizeFiles(
        authFetchCache,
        cli,
        cssBaseUrl,
        providedAccountInfo,
        cli.fileCount,
        cli.fileSize,
        cli.addAclFiles,
        cli.addAcrFiles,
        cli.addAcFilePerResource,
        cli.addAcFilePerDir,
        cli.dirDepth
      );
    }

    if (cli.generateRdf) {
      await generateRdfFiles(
        cli.baseRdfFile || "error",
        authFetchCache,
        cli,
        cssBaseUrl,
        providedAccountInfo,
        cli.addAclFiles,
        cli.addAcrFiles
      );
    }

    if (cli.generateFromDir && cli.generatedDataBaseDir) {
      await populatePodsFromDir(
        authFetchCache,
        cli,
        cssBaseUrl,
        cli.generatedDataBaseDir,
        cli.addAclFiles,
        cli.addAcrFiles
      );
    }
  }

  if (cli.userJsonOut) {
    await fs.promises.writeFile(
      cli.userJsonOut,
      JSON.stringify(createdUsersInfo, null, 3),
      { encoding: "utf-8" }
    );
    cli.v2(`Wrote user info to '${cli.userJsonOut}'`);
  }
}

//require.main === module only works for CommonJS, not for ES modules in Node.js
//(though on my test system with node v15.14.0 it works, and on another system with node v17.5.0 it doesn't)
//so we will simply not check. That means you don't want to import this module by mistake.
// if (require.main === module) {
try {
  await main();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
// }
