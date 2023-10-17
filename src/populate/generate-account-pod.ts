import { createAccount, uploadPodFile } from "../solid/solid-upload.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { CONTENT_TYPE_TXT } from "../utils/content-type.js";
import { CliArgsPopulate } from "./populate-args.js";
import {
  AccountCreateOrder,
  CreateAccountMethod,
  PodAndOwnerInfo,
} from "../common/account.js";
import {
  discoverCreateAccountTypeAndUri,
  getServerBaseUrl,
} from "../utils/solid-server-detect";

export async function generateAccountsAndPods(
  cli: CliArgsPopulate,
  accountCreateOrders: AccountCreateOrder[]
): Promise<PodAndOwnerInfo[]> {
  let i = 0;
  const res: PodAndOwnerInfo[] = [];

  const createAccountInfoByServer: {
    [url: string]: [CreateAccountMethod, string];
  } = {};

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

    const createdUserInfo = await createAccount(cli, {
      ...accountCreateOrder,
      createAccountMethod: createAccountInfo[0],
      createAccountUri: createAccountInfo[1],
    });
    if (createdUserInfo) res.push(createdUserInfo);

    i += 1;
  }
  return res;
}
