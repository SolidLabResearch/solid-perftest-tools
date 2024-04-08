import fs from "fs";
import { readFile } from "node:fs/promises";

import {
  addAuthZFile,
  addAuthZFiles,
  uploadPodFile,
} from "../solid/solid-upload.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { CONTENT_TYPE_ACL, CONTENT_TYPE_BYTE } from "../utils/content-type.js";
import { CliArgsPopulate } from "./populate-args.js";
import {
  fileExists,
  localPathToUrlPath,
  makeDirListing,
} from "../utils/file-utils.js";
import {
  AccountCreateOrder,
  accountEmail,
  PodAndOwnerInfo,
} from "../common/interfaces.js";
import {
  promiseAllWithLimit,
  promiseAllWithLimitByServer,
} from "../utils/async-limiter.js";
import { copyFile } from "fs/promises";
import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";
import { lock, unlock } from "proper-lockfile";
import {
  convertRdf,
  extToRdfType,
  RDFContentTypeMap,
  RDFFormatMap,
} from "../utils/rdf-helpers.js";
import { joinUri } from "../utils/uri_helper.js";
import { AnyFetchResponseType } from "../utils/generic-fetch.js";
import { discardBodyData } from "../flood/flood-steps";
import stream from "node:stream";

// Node.js fs async function have no stacktrace
// See https://github.com/nodejs/node/issues/30944
// This works around that. And makes the code very ugly.
async function fixFsStacktrace<T>(fsPromise: Promise<T>): Promise<T> {
  try {
    return await fsPromise;
  } catch (e: any) {
    throw new Error(e.message);
  }
}

export class UploadDirsCache {
  cacheFilename?: string = undefined;
  db?: Database<sqlite3.Database, sqlite3.Statement> = undefined;

  constructor(cacheFilename?: string) {
    this.cacheFilename = cacheFilename;
  }

  private index(pod: PodAndOwnerInfoAndDirInfo, filename: string): string {
    return `${pod.webID}-${filename}`;
  }

  async add(pod: PodAndOwnerInfoAndDirInfo, filename: string): Promise<void> {
    const index = this.index(pod, filename);
    const result = await (
      await this.getDB()
    ).run("INSERT INTO upload_dirs_cache (name) VALUES (?)", index);
  }

  async getDB(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
    if (!this.db) {
      this.db = await open({
        filename: this.cacheFilename!,
        driver: sqlite3.Database,
      });
      await this.db.exec(
        "CREATE TABLE IF NOT EXISTS upload_dirs_cache (name TEXT)"
      );
    }
    return this.db;
  }

  async flush() {
    await this.getDB();
  }

  async has(
    pod: PodAndOwnerInfoAndDirInfo,
    filename: string
  ): Promise<boolean> {
    const index = this.index(pod, filename);
    const result = await (
      await this.getDB()
    ).get("SELECT name FROM upload_dirs_cache WHERE name = ?", index);
    //returns { name: index } or undefined
    return !!result;
  }
}

// version using the filesystem  (had bugs)
// export class UploadDirsCache {
//   cacheFilename?: string = undefined;
//   createdDirs: Set<string> = new Set();
//   saveCountDown: number = 0;
//   onSaveCallback: (count: number) => void;
//
//   constructor(
//     cacheFilename?: string,
//     onSaveCallback?: (count: number) => void,
//     createdPods?: Set<string>
//   ) {
//     this.cacheFilename = cacheFilename;
//     this.onSaveCallback = onSaveCallback || ((a) => {});
//     this.createdDirs = createdPods ? createdPods : new Set();
//   }
//
//   private index(pod: PodAndOwnerInfoAndDirInfo, filename: string): string {
//     return `${pod.webID}-${filename}`;
//   }
//
//   async add(pod: PodAndOwnerInfoAndDirInfo, filename: string): Promise<void> {
//     this.createdDirs.add(this.index(pod, filename));
//     this.saveCountDown++;
//     //TODO only add every X files or Y time
//     if (this.saveCountDown >= 1000) {
//       this.saveCountDown = 0;
//       await this.flush();
//       this.onSaveCallback(this.createdDirs.size);
//     }
//   }
//
//   async flush() {
//     try {
//       if (this.cacheFilename) {
//         if (!(await fileExists(this.cacheFilename))) {
//           // Make sure there is at least an empty file.
//
//           // Possible race condition :-/
//           // Sadly, we can't lock a file before it exists.
//           await fixFsStacktrace(
//             fs.promises.writeFile(this.cacheFilename, "{}", {
//               encoding: "utf-8",
//             })
//           );
//         }
//
//         //get a file lock
//         await fixFsStacktrace(
//           lock(this.cacheFilename, {
//             stale: 10000,
//             retries: { retries: 100, minTimeout: 10, maxTimeout: 100 },
//           })
//         );
//         try {
//           const dirArr = [...this.createdDirs.values()];
//           const newFileContent = JSON.stringify(dirArr, null, 3);
//
//           const cacheFilenameTmp = `${this.cacheFilename}.TMP`;
//           const cacheFilenameTmp2 = `${this.cacheFilename}.TMP.OLD`;
//           await fixFsStacktrace(
//             fs.promises.writeFile(cacheFilenameTmp, newFileContent, {
//               encoding: "utf-8",
//             })
//           );
//           console.assert(
//             await fileExists(cacheFilenameTmp),
//             `flush 1 cacheFilenameTmp=${cacheFilenameTmp} does not exist`
//           );
//           // await fs.promises.copyFile(cacheFilenameTmp, this.cacheFilename);
//           if (await fileExists(this.cacheFilename)) {
//             await fixFsStacktrace(
//               fs.promises.rename(this.cacheFilename, cacheFilenameTmp2)
//             );
//           }
//           console.assert(
//             await fileExists(cacheFilenameTmp),
//             `flush 2 cacheFilenameTmp=${cacheFilenameTmp} does not exist`
//           );
//           await fixFsStacktrace(
//             fs.promises.rename(cacheFilenameTmp, this.cacheFilename)
//           );
//           if (await fileExists(cacheFilenameTmp2)) {
//             await fixFsStacktrace(fs.promises.rm(cacheFilenameTmp2));
//           }
//         } finally {
//           await fixFsStacktrace(unlock(this.cacheFilename));
//         }
//       }
//     } catch (e) {
//       console.log("error in UploadDirsCache.flush()", e);
//       throw e;
//     }
//   }
//
//   has(pod: PodAndOwnerInfoAndDirInfo, filename: string): boolean {
//     return this.createdDirs.has(this.index(pod, filename));
//   }
//
//   public static async fromFile(
//     cacheFilename: string,
//     onSaveCallback?: (count: number) => void
//   ): Promise<UploadDirsCache> {
//     const fileContent = await fixFsStacktrace(
//       fs.promises.readFile(cacheFilename, "utf-8")
//     );
//     const createdPods: Set<string> = new Set(JSON.parse(fileContent));
//     return new UploadDirsCache(cacheFilename, onSaveCallback, createdPods);
//   }
// }

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

const DIR_ACL_PUBLIC_READ = `# Root ACL resource for the agent account
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

# The dir itself is readable/listable by the public
<#public>
    a acl:Authorization;
    acl:agentClass foaf:Agent;
    acl:accessTo <./>;
    acl:mode acl:Read.

# The owner has full access to every resource in their pod.
# Other agents have no access rights,
# unless specifically authorized in other .acl resources.
<#owner>
    a acl:Authorization;
    acl:agent <WEBID>;
    # Optional owner email, to be used for account recovery:
    
    # Set the access to the root storage folder itself
    acl:accessTo <./>;
    # All resources will inherit this authorization, by default
    acl:default <./>;
    # The owner has all of the access modes allowed
    acl:mode
        acl:Read, acl:Write, acl:Control.
`;

/**
 *
 * @param usersInfos
 * @param authFetchCache
 * @param cli
 * @param addAclFiles
 * @param addAcrFiles
 * @param uploadDirsCache
 * @param maxParallelism
 * @param dirsPublicReadable
 */
export async function populatePodsFromDir(
  usersInfos: PodAndOwnerInfoAndDirInfo[],
  authFetchCache: AuthFetchCache,
  cli: CliArgsPopulate,
  addAclFiles: boolean = false,
  addAcrFiles: boolean = false,
  uploadDirsCache?: UploadDirsCache,
  maxParallelism: number = 1,
  dirsPublicReadable: boolean = true
) {
  //This expects a very specific dir layout, typically generated by jbr
  //  in generatedDataBaseDir there must be subdirs named for accounts/pods.
  //      (accounts and pod names are always assumed to be the same)
  //  in these subdirs, are the files to be stored in these pod

  cli.v3(
    `populatePodsFromDir(usersInfos.length=${usersInfos.length}, usersInfos[0].webID=${usersInfos[0]?.webID}, ` +
      `usersInfos[0].dir=${usersInfos[0].dir}, addAclFiles=${addAclFiles}, addAcrFiles=${addAcrFiles})`
  );

  const workTodoByServer: Record<string, (() => Promise<void>)[]> = {};
  let skipCount = 0;
  for (const pod of usersInfos) {
    let debugCounter = 5;
    const podAuth = await authFetchCache.getPodAuth(pod);

    const podListing = await makeDirListing(pod.dir, true);

    if (!podListing.files) {
      cli.v1(
        `populatePodsFromDir will skip empty ${pod.dir} for pod ${pod.podUri}`
      );
      continue;
    }

    cli.v1(
      `populatePodsFromDir will prepare upload of ${podListing.files.length} files to pod ${pod.podUri} (${pod.index}). First file: "${podListing.files[0].pathFromBase}"`
    );
    // cli.v3(
    //   `populatePodsFromDir will upload files to pod ${
    //     pod.podUri
    //   }: ${JSON.stringify(
    //     podListing.files.map((e) => e.pathFromBase),
    //     null,
    //     3
    //   )}`
    // );

    //We don't need to create containers, they should be auto created according to the spec
    // for (const dirToCreate of podListing.dirs) {
    //   const podFilePath = joinUri(xxxxxx, xxxxxxx); `${accountDirPath}/${dirToCreate.pathFromBase}`;
    //   ... create dir in pod
    // }

    const dirsUploaded: Set<string> = new Set();

    for (const fileToUpload of podListing.files) {
      const podFilePath = fileToUpload.fullPath;
      const filePathInPod = localPathToUrlPath(fileToUpload.pathFromBase);
      const fileName = fileToUpload.name;
      const fileDirInPod = filePathInPod.substring(
        0,
        filePathInPod.length - encodeURIComponent(fileName).length
      );
      dirsUploaded.add(fileDirInPod);

      const fileExtDotPos = fileName.lastIndexOf(".");
      const hasExt = fileExtDotPos != -1;
      const fileExtDotNegPos = hasExt ? fileExtDotPos - fileName.length : 0;

      const fileExt = fileName.slice(fileExtDotPos + 1);
      const fileNameWithoutExt = hasExt
        ? fileName.slice(0, fileExtDotNegPos)
        : fileName;
      const filePathInPodWithoutEx = hasExt
        ? filePathInPod.slice(0, fileExtDotNegPos)
        : filePathInPod;
      const filePathInPodWithoutExEncoded = filePathInPodWithoutEx;

      const rdfType = extToRdfType(fileExt);
      const contentType = rdfType
        ? RDFContentTypeMap[rdfType]
        : CONTENT_TYPE_BYTE;

      if (
        !uploadDirsCache ||
        !(await uploadDirsCache.has(pod, filePathInPodWithoutExEncoded))
      ) {
        const work = async () => {
          cli.v3(
            `Uploading. account=${pod.username} file='${podFilePath}' 
            filePathInPodWithoutEx='${filePathInPodWithoutEx} filePathInPodWithoutExEncoded=${filePathInPodWithoutExEncoded} contentType='${contentType}'`
          );

          let fileContent = await readFile(podFilePath, { encoding: "utf8" });

          if (filePathInPodWithoutEx == "profile/card") {
            //This is a bit of a hack, to merge CSS generated profile/card with jbr generated profile/card

            const options: any = {
              method: "GET",
              Accept: contentType,
            };
            console.info(
              `profile/card ${pod.username} ${filePathInPodWithoutEx}: Request Accept=${contentType}`
            );
            const url = joinUri(pod.podUri, filePathInPodWithoutEx);
            const res: AnyFetchResponseType = await fetch(url, options);
            if (!res.ok) {
              const bodyError = await res.text();
              const errorMessage =
                `${res.status} - GET with account ${pod.username}, pod path "${filePathInPodWithoutEx}" failed` +
                `(URL=${url}): ${bodyError}`;
              throw new Error(errorMessage);
            } else {
              if (res.body) {
                //MERGE server and local version. (If not already done.)
                let serverContent: string = await res.text();
                const resContentType = res?.headers?.get("content-type");

                console.info(
                  `profile/card ${pod.username} ${filePathInPodWithoutEx}: Result Content-Type=${resContentType}`
                );

                if (serverContent.trim().endsWith(fileContent.trim())) {
                  console.info(
                    `profile/card ${pod.username} ${filePathInPodWithoutEx}: server content already contains content to add: doing nothing`
                  );
                  skipCount++;
                  return;
                } else {
                  if (!resContentType?.includes(contentType)) {
                    // throw new Error(
                    //   `result Content-Type (${resContentType}) is different from requested (${contentType})`
                    // );
                    const origServerContent = serverContent;
                    serverContent = (
                      await convertRdf(
                        stream.Readable.from([origServerContent]),
                        rdfType || "N_QUADS"
                      )
                    ).toString();

                    console.warn(
                      `profile/card ${pod.username} ${filePathInPodWithoutEx}: result Content-Type (${resContentType}) is different from requested (${contentType}). 
                      Converted it ourself to ${rdfType}, ${origServerContent.length} byte to ${serverContent.length} byte.`
                    );
                  }

                  if (serverContent.trim().endsWith(fileContent.trim())) {
                    console.info(
                      `profile/card ${pod.username} ${filePathInPodWithoutEx}: 2 server content already contains content to add: doing nothing`
                    );
                    skipCount++;
                    return;
                  } else {
                    console.info(
                      `profile/card ${pod.username} ${filePathInPodWithoutEx}: adding server content to content to upload`
                    );
                    fileContent = serverContent + "\n" + fileContent;

                    //BACKUP old data
                    console.info(
                      `profile/card ${pod.username} ${filePathInPodWithoutEx}: backing up data to ${filePathInPodWithoutEx}_orig`
                    );
                    await uploadPodFile(
                      cli,
                      pod,
                      serverContent,
                      `${filePathInPodWithoutEx}_orig`,
                      podAuth,
                      contentType,
                      debugCounter > 0,
                      true,
                      20
                    );
                  }
                }
              } else {
                console.warn(
                  `profile/card ${pod.username} ${filePathInPodWithoutEx}: successful fetch GET, but no body!`
                );
              }
            }
          }

          await uploadPodFile(
            cli,
            pod,
            fileContent,
            filePathInPodWithoutExEncoded,
            podAuth,
            contentType,
            debugCounter > 0,
            true,
            20
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
              fileNameWithoutExt,
              true,
              false,
              false,
              debugCounter > 0,
              authZType,
              false,
              true,
              15
            );
          }
          await uploadDirsCache?.add(pod, filePathInPodWithoutExEncoded);
        };

        if (!workTodoByServer[pod.oidcIssuer]) {
          workTodoByServer[pod.oidcIssuer] = [];
        }
        workTodoByServer[pod.oidcIssuer].push(work);
      } else {
        //skip previously uploaded file
        //TODO test if file is actually uploaded?
        skipCount++;
      }
      if (debugCounter > 0) debugCounter--;
    }

    if (addAclFiles && dirsPublicReadable) {
      for (const dir of dirsUploaded.keys()) {
        const dirWithSlash = `${dir}${dir.endsWith("/") ? "" : "/"}`;
        if (dirWithSlash == "/") {
          continue;
        }
        const dirAcl = `${dirWithSlash}.acl`;
        const contentType = CONTENT_TYPE_ACL;
        if (!uploadDirsCache || !(await uploadDirsCache.has(pod, dirAcl))) {
          const work = async () => {
            cli.v3(
              `Uploading dir acl. account=${pod.username} file='${dirAcl}' contentType='${contentType}'`
            );

            await uploadPodFile(
              cli,
              pod,
              DIR_ACL_PUBLIC_READ.replace("WEBID", pod.webID),
              dirAcl,
              podAuth,
              contentType,
              debugCounter > 0,
              true,
              20
            );
            await uploadDirsCache?.add(pod, dirAcl);
          };

          if (!workTodoByServer[pod.oidcIssuer]) {
            workTodoByServer[pod.oidcIssuer] = [];
          }
          workTodoByServer[pod.oidcIssuer].push(work);
        } else {
          //skip previously uploaded dir .acl
          skipCount++;
        }
      }
    }
  }

  const serverCount = Object.keys(workTodoByServer).length;
  let uploadCount = 0;
  for (const workToDo of Object.values(workTodoByServer)) {
    uploadCount += workToDo.length;
  }
  cli.v1(
    `populatePodsFromDir prepare done. Will now upload ${uploadCount} files to ${serverCount} servers. ${skipCount} uploads skipped because already done.`
  );

  if (maxParallelism <= 1) {
    for (const workToDo of Object.values(workTodoByServer)) {
      for (const work of workToDo) {
        await work();
      }
    }
  } else {
    await promiseAllWithLimitByServer(maxParallelism, workTodoByServer);
  }

  await uploadDirsCache?.flush();
}
