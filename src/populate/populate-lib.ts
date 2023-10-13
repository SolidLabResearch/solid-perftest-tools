#!/usr/bin/env node

import {
  findAccountsFromDir,
  populatePodsFromDir,
} from "./populate-from-dir.js";
import {
  PodAndOwnerInfo,
  generateAccountsAndPodsFromList,
} from "./generate-account-pod.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { AnyFetchType } from "../utils/generic-fetch.js";
import nodeFetch from "node-fetch";
import { CliArgsPopulate } from "./populate-args.js";
import { AccountAction, AccountSource } from "../common/cli-args.js";

export type { PodAndOwnerInfo } from "./generate-account-pod.js";
export async function populateServersFromDir({
  verbose,
  urlToDirMap,
  authorization,
}: {
  verbose: boolean;
  urlToDirMap: { [dir: string]: string };
  authorization: "WAC" | "ACP" | undefined;
}): Promise<PodAndOwnerInfo[]> {
  //just hack together some CliArgs for consistency
  const cli: CliArgsPopulate = {
    verbosity_count: verbose ? 1 : 0,
    cssBaseUrl: Object.keys(urlToDirMap).map((u) =>
      u.endsWith("/") ? u : u + "/"
    ),

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

  const createdUsersInfo: PodAndOwnerInfo[] = [];

  for (const [cssBaseUrl, dir] of Object.entries(urlToDirMap)) {
    const accounts = await findAccountsFromDir(dir);
    const authFetchCache = new AuthFetchCache(cli, accounts, true, "all");

    if (cli.accountAction !== AccountAction.UseExisting) {
      console.log(
        `Will generate user & pod for server ${cssBaseUrl}: ${JSON.stringify(
          accounts,
          null,
          3
        )}`
      );
      await generateAccountsAndPodsFromList(
        cli,
        cssBaseUrl,
        authFetchCache,
        accounts,
        createdUsersInfo
      );
    }

    await populatePodsFromDir(
      authFetchCache,
      cli,
      cssBaseUrl,
      dir,
      cli.addAclFiles,
      cli.addAcrFiles
    );
  }

  return createdUsersInfo;
}
