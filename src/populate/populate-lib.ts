#!/usr/bin/env node

import {
  AccountCreateOrderAndDirInfo,
  findAccountsFromDir,
  PodAndOwnerInfoAndDirInfo,
  populatePodsFromDir,
} from "./populate-from-dir.js";
import { AccountCreateOrder, PodAndOwnerInfo } from "../common/interfaces.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { AnyFetchType } from "../utils/generic-fetch.js";
import { CliArgsPopulate } from "./populate-args.js";
import { AccountAction, AccountSource } from "../common/interfaces.js";
import { generateAccountsAndPods } from "./generate-account-pod.js";

export type { PodAndOwnerInfo } from "../common/interfaces.js";

export async function populateServersFromDir({
  verbose,
  urlToDirMap,
  authorization,
}: {
  verbose: boolean;
  urlToDirMap: { [accountCreateUri: string]: string };
  authorization: "WAC" | "ACP" | undefined;
}): Promise<PodAndOwnerInfo[]> {
  //solidlab-perftest-tools was written to work from CLI
  //One assumption that follows from that, is that the CLI args given are available.
  //Since we call as a library here, there are no CliArgs.
  //To work around this, we generate CliArgs that request what we want to do.
  const cli: CliArgsPopulate = {
    verbosity_count: verbose ? 2 : 0,
    accountSourceTemplateCreateAccountMethod: undefined,
    accountSourceTemplateCreateAccountUri: "",

    accountAction: AccountAction.Auto,
    //accountSource configs are not used but require values anyway
    accountSource: AccountSource.File,
    accountSourceCount: 0,
    accountSourceFile: "error",
    accountSourceTemplateUsername: "error",
    accountSourceTemplatePass: "password",

    fileSize: 0,
    fileCount: 0,
    addAclFiles: authorization == "WAC",
    addAcrFiles: authorization == "ACP",
    userJsonOut: undefined,
    dirDepth: 0,
    addAcFilePerDir: true,
    addAcFilePerResource: true,
    generateVariableSize: false,
    generateFixedSize: false,
    generateRdf: false,
    generateFromDir: true,
    generatedDataBaseDir: Object.values(urlToDirMap)[0],
    baseRdfFile: undefined,

    v3: (message?: any, ...optionalParams: any[]) => {},
    v2: (message?: any, ...optionalParams: any[]) => {},
    v1: (message?: any, ...optionalParams: any[]) => {
      if (verbose) console.log(message, ...optionalParams);
    },
  };

  const createdUsersInfo: PodAndOwnerInfoAndDirInfo[] = [];
  for (const [ssAccountCreateUri, dir] of Object.entries(urlToDirMap)) {
    //Beware: accounts are indexed PER server in this setup.
    //        this works here, because there is an authFetchCache per server.
    //        But when modifying this code, be aware that authFetchCache relies on a unique index.
    const accounts: AccountCreateOrderAndDirInfo[] = await findAccountsFromDir(
      dir,
      ssAccountCreateUri
    );

    let currentCreatedUsersInfo: PodAndOwnerInfoAndDirInfo[];
    if (cli.accountAction !== AccountAction.UseExisting) {
      cli.v1(
        `Will generate ${
          accounts.length
        } user & pod for server ${ssAccountCreateUri}. First account=${JSON.stringify(
          accounts ? accounts[0] : "empty account list",
          null,
          3
        )}`
      );
      currentCreatedUsersInfo = (
        await generateAccountsAndPods(cli, accounts)
      ).map((p) => ({ ...p, dir }));
      cli.v2(`Created ${currentCreatedUsersInfo.length} accounts & pods`);
    } else {
      //TODO get info on existing accounts, or throw error
      throw Error(
        "populateServersFromDir does not support using existing accounts (yet)."
      );
    }

    createdUsersInfo.push(
      ...currentCreatedUsersInfo.map((p) => ({
        ...p,
        index: p.index + createdUsersInfo.length,
      }))
    );

    const authFetchCache = new AuthFetchCache(
      cli,
      currentCreatedUsersInfo,
      true,
      "all"
    );
    await authFetchCache.discoverMachineLoginMethods();

    cli.v1(`Uploading files to pods`);
    await populatePodsFromDir(
      createdUsersInfo,
      authFetchCache,
      cli,
      cli.addAclFiles,
      cli.addAcrFiles
    );
    cli.v1(`Uploaded files to pods`);
  }

  cli.v2(
    `Finished creating accounts+pods & uploading content. Total: ${createdUsersInfo.length}`
  );

  return createdUsersInfo;
}
