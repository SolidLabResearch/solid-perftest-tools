import { createAccount, uploadPodFile } from "../solid/solid-upload.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { CONTENT_TYPE_TXT } from "../utils/content-type.js";
import { CliArgsPopulate } from "./populate-args.js";
import { AccountCreateOrder, PodAndOwnerInfo } from "../common/account.js";

export async function generateAccountsAndPods(
  cli: CliArgsPopulate,
  providedAccountInfo: AccountCreateOrder[],
  createdUserArr: PodAndOwnerInfo[]
) {
  await generateAccountsAndPodsFromList(
    cli,
    providedAccountInfo,
    createdUserArr
  );
}

export async function generateAccountsAndPodsFromList(
  cli: CliArgsPopulate,
  accountCreateOrders: AccountCreateOrder[],
  createdUserArr: PodAndOwnerInfo[]
) {
  let i = 0;
  for (const accountCreateOrder of accountCreateOrders) {
    const createdUserInfo = await createAccount(cli, accountCreateOrder);
    if (createdUserInfo) createdUserArr.push(createdUserInfo);

    i += 1;
  }
}
