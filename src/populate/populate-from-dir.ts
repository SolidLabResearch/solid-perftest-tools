import fs from "fs";
import { readFile } from "node:fs/promises";

import {
  addAuthZFile,
  addAuthZFiles,
  uploadPodFile,
} from "../solid/solid-upload.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { CONTENT_TYPE_BYTE } from "../utils/content-type.js";
import { CliArgsPopulate } from "./populate-args.js";
import { makeDirListing } from "../utils/file-utils.js";
import {
  AccountCreateOrder,
  accountEmail,
  PodAndOwnerInfo,
} from "../common/interfaces.js";

export interface AccountCreateOrderAndDirInfo extends AccountCreateOrder {
  dir: string;
}
export interface PodAndOwnerInfoAndDirInfo extends PodAndOwnerInfo {
  dir: string;
}

export async function findAccountsFromDir(
  dir: string,
  ssAccountCreateUri: string
): Promise<AccountCreateOrderAndDirInfo[]> {
  //This expects a very specific dir layout, typically generated by jbr
  //  in dir there must be subdirs named for accounts/pods.
  //      (accounts and pod names are always assumed to be the same)

  const listing = await makeDirListing(dir, false);
  // return listing.dirs.map((d) => d.name);
  const providedAccountInfo: AccountCreateOrderAndDirInfo[] = [];
  for (const accountDir of listing.dirs) {
    const ai = {
      username: accountDir.name,
      password: "password",
      podName: accountDir.name,
      email: accountEmail(accountDir.name),
      index: providedAccountInfo.length,
      dir: accountDir.fullPath,
      createAccountMethod: undefined, //= auto-detect from URI
      createAccountUri: ssAccountCreateUri,
    };
    providedAccountInfo.push(ai);
  }
  return providedAccountInfo;
}

/**
 *
 * @param usersInfos
 * @param authFetchCache
 * @param cli
 * @param generatedDataBaseDir a dir with subdirs per pod for the server to populate. (= NOT a dir with subdirs per server!)
 * @param ssAccountCreateUri
 * @param addAclFiles
 * @param addAcrFiles
 */
export async function populatePodsFromDir(
  usersInfos: PodAndOwnerInfoAndDirInfo[],
  authFetchCache: AuthFetchCache,
  cli: CliArgsPopulate,
  addAclFiles: boolean = false,
  addAcrFiles: boolean = false
) {
  //This expects a very specific dir layout, typically generated by jbr
  //  in generatedDataBaseDir there must be subdirs named for accounts/pods.
  //      (accounts and pod names are always assumed to be the same)
  //  in these subdirs, are the files to be stored in these pod

  console.debug(
    `populatePodsFromDir(usersInfos.length=${usersInfos.length}, usersInfos[0].webID=${usersInfos[0]?.webID}, ` +
      `usersInfos[0].dir=${usersInfos[0].dir}, addAclFiles=${addAclFiles}, addAcrFiles=${addAcrFiles})`
  );

  for (const pod of usersInfos) {
    const podAuth = await authFetchCache.getPodAuth(pod);

    const podListing = await makeDirListing(pod.dir, true);

    // console.log(
    //   `populatePodsFromDir will create dirs in pod ${account}: ${JSON.stringify(
    //     podListing.dirs.map((e) => e.pathFromBase),
    //     null,
    //     3
    //   )}`
    // );
    console.log(
      `populatePodsFromDir will upload files to pod ${
        pod.podUri
      }: ${JSON.stringify(
        podListing.files.map((e) => e.pathFromBase),
        null,
        3
      )}`
    );

    //We don't need to create containers, they should be auto created according to the spec
    // for (const dirToCreate of podListing.dirs) {
    //   const podFilePath = joinUri(xxxxxx, xxxxxxx); `${accountDirPath}/${dirToCreate.pathFromBase}`;
    //   ... create dir in pod
    // }

    for (const fileToUpload of podListing.files) {
      const podFilePath = fileToUpload.fullPath;
      const filePathInPod = fileToUpload.pathFromBase;
      const fileName = fileToUpload.name;
      const fileDirInPod = filePathInPod.substring(
        0,
        filePathInPod.length - fileName.length
      );
      cli.v1(
        `Uploading. account=${pod.username} file='${podFilePath}' filePathInPod='${filePathInPod}'`
      );

      const fileContent = await readFile(podFilePath, { encoding: "utf8" });
      await uploadPodFile(
        cli,
        pod,
        fileContent,
        filePathInPod,
        podAuth,
        CONTENT_TYPE_BYTE, //TODO use correct content type
        false
      );

      const authZTypes: ("ACP" | "WAC")[] = [];
      if (addAclFiles) {
        authZTypes.push("WAC");
      }
      if (addAcrFiles) {
        authZTypes.push("ACP");
      }
      for (const authZType of authZTypes) {
        await addAuthZFile(
          cli,
          pod,
          podAuth,
          fileDirInPod,
          fileName,
          true,
          false,
          false,
          true,
          authZType,
          false
        );
      }
    }
  }
}
