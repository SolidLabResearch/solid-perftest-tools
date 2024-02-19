#!/usr/bin/env node

import { populatePodsFromDir } from "./populate-from-dir.js";
import {
  generateFixedSizeFiles,
  generateRdfFiles,
  generateVariableSizeFiles,
} from "./generate-files.js";
import { generateAccountsAndPods } from "./generate-account-pod.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { getCliArgs } from "./populate-args.js";
import fs from "fs";
import { AccountCreateOrder, PodAndOwnerInfo } from "../common/interfaces.js";
import {
  getAccountCreateOrders,
  getExistingAccountsAndPods,
} from "../common/account.js";
import { AccountAction } from "../common/interfaces.js";
import { addAuthZFiles, uploadPodFile } from "../solid/solid-upload.js";
import { CONTENT_TYPE_BYTE, CONTENT_TYPE_TXT } from "../utils/content-type.js";
import { joinUri } from "../utils/uri_helper.js";

async function main() {
  const cli = getCliArgs();

  const accountCreateOrders: AccountCreateOrder[] =
    cli.accountAction == AccountAction.UseExisting
      ? []
      : await getAccountCreateOrders(cli);
  let createdUserInfos: PodAndOwnerInfo[] = [];

  if (cli.accountAction != AccountAction.UseExisting) {
    //TODO handle Auto and Create differently
    createdUserInfos = await generateAccountsAndPods(cli, accountCreateOrders);
  } else {
    createdUserInfos = await getExistingAccountsAndPods(cli);
  }

  const authFetchCache = new AuthFetchCache(cli, createdUserInfos, true, "all");
  await authFetchCache.discoverMachineLoginMethods();

  for (const createdUserInfo of createdUserInfos) {
    //create dummy.txt
    const podAuth = await authFetchCache.getPodAuth(createdUserInfo);
    await uploadPodFile(
      cli,
      createdUserInfo,
      "DUMMY DATA FOR " + createdUserInfo.username,
      "dummy.txt",
      podAuth,
      CONTENT_TYPE_BYTE,
      // CONTENT_TYPE_TXT,
      createdUserInfo.index < 2
    );

    await addAuthZFiles(
      cli,
      createdUserInfo,
      podAuth,
      "dummy.txt",
      true,
      false,
      false,
      createdUserInfo.index < 2,
      cli.addAclFiles,
      cli.addAcrFiles,
      cli.addAcFilePerResource,
      cli.addAcFilePerDir,
      cli.dirDepth
    );
  }

  if (cli.generateVariableSize) {
    await generateVariableSizeFiles(
      authFetchCache,
      cli,
      createdUserInfos,
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
      createdUserInfos,
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
      createdUserInfos,
      cli.addAclFiles,
      cli.addAcrFiles
    );
  }

  if (cli.generateFromDir && cli.generatedDataBaseDir) {
    await populatePodsFromDir(
      createdUserInfos.map((p) => ({
        ...p,
        //QUICK hack to match dirs with users
        dir: joinUri(cli.generatedDataBaseDir!, p.username),
      })),
      authFetchCache,
      cli,
      cli.addAclFiles,
      cli.addAcrFiles
    );
  }

  if (cli.userJsonOut) {
    try {
      await fs.promises.writeFile(
        cli.userJsonOut,
        JSON.stringify(createdUserInfos, null, 3),
        { encoding: "utf-8" }
      );
    } catch (e: any) {
      // Node.js fs async function have no stacktrace
      // See https://github.com/nodejs/node/issues/30944
      // This works around that. And makes the code very ugly.
      throw new Error(e.message);
    }
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
