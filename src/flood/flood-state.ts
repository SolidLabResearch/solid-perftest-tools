import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import {
  AccountCreateOrder,
  getExistingAccountsAndPods,
  PodAndOwnerInfo,
} from "../common/account.js";
import { CliArgsFlood } from "./flood-args.js";

export interface FloodState {
  //fixed info for each step (added during init)
  authFetchCache: AuthFetchCache;
  pods: PodAndOwnerInfo[];
  //variable state info
  //none yet
}

export async function initFloodstate(cli: CliArgsFlood): Promise<FloodState> {
  const pods = await getExistingAccountsAndPods(cli);

  const authFetchCache = new AuthFetchCache(
    cli,
    pods,
    cli.authenticate,
    cli.authenticateCache
  );
  await authFetchCache.discoverMachineLoginMethods();

  return {
    authFetchCache: authFetchCache,
    pods: pods,
  };
}
