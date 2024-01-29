import { createAccount, uploadPodFile } from "../solid/solid-upload.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { CONTENT_TYPE_TXT } from "../utils/content-type.js";
import { CliArgsPopulate } from "./populate-args.js";
import {
  AccountCreateOrder,
  CreateAccountMethod,
  PodAndOwnerInfo,
} from "../common/interfaces.js";
import {
  discoverCreateAccountTypeAndUri,
  getServerBaseUrl,
} from "../utils/solid-server-detect.js";
import fs from "fs";
import { promiseAllWithLimit } from "../utils/async-limiter";

export class GenerateAccountsAndPodsCache {
  cacheFilename?: string = undefined;
  createdPods: Record<string, PodAndOwnerInfo> = {};

  constructor(
    cacheFilename?: string,
    createdPods?: Record<string, PodAndOwnerInfo>
  ) {
    this.cacheFilename = cacheFilename;
    this.createdPods = createdPods ? createdPods : {};
  }

  private index(accountCreateOrder: AccountCreateOrder): string {
    return `${accountCreateOrder.username}-${accountCreateOrder.podName}-${accountCreateOrder.createAccountUri}`;
  }

  async add(
    accountCreateOrder: AccountCreateOrder,
    podAndOwnerInfo: PodAndOwnerInfo
  ): Promise<void> {
    this.createdPods[this.index(accountCreateOrder)] = podAndOwnerInfo;
    if (this.cacheFilename) {
      const newFileContent = JSON.stringify(this.createdPods, null, 3);
      await fs.promises.writeFile(this.cacheFilename, newFileContent, {
        encoding: "utf-8",
      });
    }
  }

  get(accountCreateOrder: AccountCreateOrder): PodAndOwnerInfo | undefined {
    console.log(
      `GenerateAccountsAndPodsCache.get() index=${this.index(
        accountCreateOrder
      )}`
    );
    return this.createdPods[this.index(accountCreateOrder)];
  }

  public static async fromFile(
    cacheFilename: string
  ): Promise<GenerateAccountsAndPodsCache> {
    const fileContent = await fs.promises.readFile(cacheFilename, "utf-8");
    const createdPods = JSON.parse(fileContent);
    console.log(
      `Read GenerateAccountsAndPodsCache from file "${cacheFilename}", saw ${
        Object.keys(createdPods).length
      } pods.`
    );
    return new GenerateAccountsAndPodsCache(cacheFilename, createdPods);
  }
}

export async function generateAccountsAndPods(
  cli: CliArgsPopulate,
  accountCreateOrders: AccountCreateOrder[],
  generateAccountsAndPodsCache?: GenerateAccountsAndPodsCache,
  maxParallelism: number = 1
): Promise<PodAndOwnerInfo[]> {
  let i = 0;
  const res: PodAndOwnerInfo[] = [];

  const createAccountInfoByServer: {
    [url: string]: [CreateAccountMethod, string];
  } = {};

  const workToDo: (() => Promise<void>)[] = [];

  for (const accountCreateOrder of accountCreateOrders) {
    console.assert(
      accountCreateOrder.createAccountUri,
      `Cannot create account without createAccountUri (use server root URI if unknown)`
    );
    const serverBaseUrl = getServerBaseUrl(
      accountCreateOrder.createAccountUri!
    );
    if (!createAccountInfoByServer[serverBaseUrl]) {
      createAccountInfoByServer[serverBaseUrl] =
        await discoverCreateAccountTypeAndUri(
          cli,
          serverBaseUrl,
          accountCreateOrder.createAccountMethod,
          accountCreateOrder.createAccountUri
        );
    }
    const createAccountInfo = createAccountInfoByServer[serverBaseUrl];

    const existingAccount =
      generateAccountsAndPodsCache?.get(accountCreateOrder);
    let mustCreate = !existingAccount;
    if (existingAccount) {
      //TODO check existing account, set mustCreate=true if not existing and delete from cache
      res.push(existingAccount);
    }
    if (mustCreate) {
      workToDo.push(() => {
        return (async () => {
          cli.v1(
            `Creating "${accountCreateOrder.username}" account and pod (${i}/${accountCreateOrders.length})`
          );
          i += 1;
          const createdUserInfo = await createAccount(cli, {
            ...accountCreateOrder,
            createAccountMethod: createAccountInfo[0],
            createAccountUri: createAccountInfo[1],
          });
          if (createdUserInfo) {
            generateAccountsAndPodsCache?.add(
              accountCreateOrder,
              createdUserInfo
            );
            res.push(createdUserInfo);
          }
        })();
      });
    }
  }

  if (workToDo) {
    if (maxParallelism <= 1) {
      for (const work of workToDo) {
        await work();
      }
    } else {
      await promiseAllWithLimit(maxParallelism, workToDo);
    }
  }

  return res;
}
