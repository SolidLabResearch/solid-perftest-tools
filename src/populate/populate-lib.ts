#!/usr/bin/env node

import {
  AccountCreateOrderAndDirInfo,
  findAccountsFromDir,
  PodAndOwnerInfoAndDirInfo,
  populatePodsFromDir,
  UploadDirsCache,
} from "./populate-from-dir.js";
import { AccountCreateOrder, PodAndOwnerInfo } from "../common/interfaces.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { AnyFetchType } from "../utils/generic-fetch.js";
import { CliArgsPopulate } from "./populate-args.js";
import { AccountAction, AccountSource } from "../common/interfaces.js";
import {
  generateAccountsAndPods,
  GenerateAccountsAndPodsCache,
} from "./generate-account-pod.js";
import * as Path from "path";
import fs from "fs/promises";
import { dirExists, fileExists } from "../utils/file-utils";
export type { PodAndOwnerInfo } from "../common/interfaces.js";

export async function populateServersFromDir({
  verbose,
  urlToDirMap,
  authorization,
  populateCacheDir,
  maxParallelism,
}: {
  verbose: boolean;
  urlToDirMap: { [accountCreateUri: string]: string };
  authorization: "WAC" | "ACP" | undefined;
  populateCacheDir: string;
  maxParallelism?: number;
}): Promise<PodAndOwnerInfo[]> {
  //solidlab-perftest-tools was written to work from CLI
  //One assumption that follows from that, is that the CLI args given are available.
  //Since we call as a library here, there are no CliArgs.
  //To work around this, we generate CliArgs that request what we want to do.
  const verbosity_count = verbose ? 1 : 0;
  const cli: CliArgsPopulate = {
    verbosity_count,
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

    v3: (message?: any, ...optionalParams: any[]) => {
      if (verbosity_count >= 3) console.log(message, ...optionalParams);
    },
    v2: (message?: any, ...optionalParams: any[]) => {
      if (verbosity_count >= 2) console.log(message, ...optionalParams);
    },
    v1: (message?: any, ...optionalParams: any[]) => {
      if (verbosity_count >= 1) console.log(message, ...optionalParams);
    },
  };

  let generateAccountsAndPodsCache: GenerateAccountsAndPodsCache | undefined =
    undefined;
  let uploadDirsCache: UploadDirsCache | undefined = undefined;
  if (populateCacheDir) {
    if (!(await dirExists(populateCacheDir))) {
      throw Error(`populateCacheDir "${populateCacheDir}" does not exist`);
    }
    let generateAccountsAndPodsCacheFile = Path.join(
      populateCacheDir,
      "generateAccountsAndPodsCache.json"
    );
    let uploadDirsCacheFile = Path.join(
      populateCacheDir,
      "uploadDirsCache.json"
    );

    if (await fileExists(generateAccountsAndPodsCacheFile)) {
      generateAccountsAndPodsCache =
        await GenerateAccountsAndPodsCache.fromFile(
          generateAccountsAndPodsCacheFile
        );
    } else {
      generateAccountsAndPodsCache = new GenerateAccountsAndPodsCache(
        generateAccountsAndPodsCacheFile
      );
    }

    if (await fileExists(uploadDirsCacheFile)) {
      uploadDirsCache = await UploadDirsCache.fromFile(uploadDirsCacheFile);
    } else {
      uploadDirsCache = new UploadDirsCache(uploadDirsCacheFile);
    }
  }

  const createdUsersInfo: PodAndOwnerInfoAndDirInfo[] = [];
  for (const [ssAccountCreateUri, serverDirWithAccounts] of Object.entries(
    urlToDirMap
  )) {
    //Beware: accounts are indexed PER server in this setup.
    //        this works here, because there is an authFetchCache per server.
    //        But when modifying this code, be aware that authFetchCache relies on a unique index.
    const accounts: AccountCreateOrderAndDirInfo[] = await findAccountsFromDir(
      serverDirWithAccounts,
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
      currentCreatedUsersInfo = await generateAccountsAndPods(
        cli,
        accounts,
        generateAccountsAndPodsCache,
        maxParallelism
      );
      cli.v2(`Created ${currentCreatedUsersInfo.length} accounts & pods`);
    } else {
      //TODO get info on existing accounts, or throw error
      throw Error(
        "populateServersFromDir does not support using existing accounts (yet)."
      );
    }

    createdUsersInfo.push(
      ...currentCreatedUsersInfo.map((p, i) => ({
        ...p,
        index: i + createdUsersInfo.length, //p.index + createdUsersInfo.length,
      }))
    );

    const authFetchCache = new AuthFetchCache(
      cli,
      currentCreatedUsersInfo,
      true,
      "all"
    );
    await authFetchCache.discoverMachineLoginMethods();

    cli.v1(`Pre-caching auth`);
    let authCacheFile = populateCacheDir
      ? Path.join(populateCacheDir, "authCache.json")
      : null;
    if (authCacheFile) {
      if (await fileExists(authCacheFile)) {
        await authFetchCache.load(authCacheFile);
        await authFetchCache.validate(authFetchCache.accountCount, 60 * 10 * 3);
      } else {
        await authFetchCache.preCache(authFetchCache.accountCount, 60 * 10 * 3);
      }
    } else {
      await authFetchCache.preCache(authFetchCache.accountCount, 60 * 10 * 3);
    }
    if (authCacheFile) {
      await authFetchCache.save(authCacheFile);
    }

    cli.v1(`Uploading files to pods`);
    await populatePodsFromDir(
      createdUsersInfo,
      authFetchCache,
      cli,
      cli.addAclFiles,
      cli.addAcrFiles,
      uploadDirsCache,
      maxParallelism
    );
    cli.v1(`Uploaded files to pods`);
  }

  cli.v1(
    `Finished creating accounts+pods & uploading content. Total: ${createdUsersInfo.length}`
  );

  return createdUsersInfo;
}
