import {
  buildAuthenticatedFetch,
  createDpopHeader,
  generateDpopKeyPair,
} from "@inrupt/solid-client-authn-core";
import { ResponseError } from "../utils/error.js";
import { AnyFetchType } from "../utils/generic-fetch.js";
import { DurationCounter } from "../utils/duration-counter.js";
import { KeyPair } from "@inrupt/solid-client-authn-core/src/authenticatedFetch/dpopUtils";
import {
  AccountApiInfo,
  accountLogin,
  createClientCredential,
  getAccountApiInfo,
  getAccountInfo,
} from "../populate/css-accounts-api.js";
import { CliArgsCommon } from "../common/cli-args.js";
import { MachineLoginMethod, PodAndOwnerInfo } from "../common/interfaces.js";
import fetch from "node-fetch";

function accountEmail(account: string): string {
  return `${account}@example.org`;
}

export interface UserToken {
  id: string;
  secret: string;
}
export interface AccessToken {
  token: string;
  dpopKeyPair: KeyPair;
  expire: Date;
}
export async function createUserToken(
  cli: CliArgsCommon,
  pod: PodAndOwnerInfo,
  fetcher: AnyFetchType = fetch,
  durationCounter: DurationCounter | null = null
): Promise<UserToken> {
  //we assume that pod.machineLoginMethod and pod.machineLoginUri are correct
  //because they have been found/checked with discoverMachineLoginTypeAndUri by the caller
  cli.v2("Creating User Token...");

  const startTime = new Date().getTime();
  try {
    if (pod.machineLoginMethod === MachineLoginMethod.CSS_V7) {
      const basicAccountApiInfo = await getAccountApiInfo(
        cli,
        `${pod.machineLoginUri}` //for v7, this is the .account URL
      );
      console.assert(
        basicAccountApiInfo !== null,
        "basicAccountApiInfo === NULL which is unexpected"
      );
      return await createUserTokenv7(cli, pod, fetcher, basicAccountApiInfo!);
    } else if (pod.machineLoginMethod === MachineLoginMethod.CSS_V6) {
      return await createUserTokenv6(cli, pod, fetcher);
    } else {
      throw new Error(
        `machineLoginMethod ${pod.machineLoginMethod} is not supported.`
      );
    }
  } finally {
    if (durationCounter !== null) {
      durationCounter.addDuration(new Date().getTime() - startTime);
    }
  }
}

export async function createUserTokenv6(
  cli: CliArgsCommon,
  pod: PodAndOwnerInfo,
  fetcher: AnyFetchType = fetch
): Promise<UserToken> {
  //see https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/client-credentials.md
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  let res = null;
  let body = null;
  if (
    pod.machineLoginMethod === MachineLoginMethod.NONE ||
    !pod.machineLoginUri
  ) {
    throw new Error(
      `There is no machine login method known for the pod. machineLoginMethod=${pod.machineLoginMethod} machineLoginUri=${pod.machineLoginUri}`
    );
  }
  try {
    res = await fetcher(pod.machineLoginUri, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `token-css-populate-${pod.username}`,
        email: pod.email,
        password: pod.password,
      }),
      signal: controller.signal,
    });

    body = await res.text();
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error(`Fetching user token took too long: aborted`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res || !res.ok) {
    console.error(
      `${res?.status} - Creating token for ${pod.username} failed:`,
      body
    );
    throw new ResponseError(res, body);
  }

  const { id, secret } = JSON.parse(body);
  return { id, secret };
}

export async function createUserTokenv7(
  cli: CliArgsCommon,
  pod: PodAndOwnerInfo,
  fetcher: AnyFetchType = fetch,
  accountApiInfo: AccountApiInfo
): Promise<UserToken> {
  ////// Login (= get cookie) /////
  const cookieHeader = await accountLogin(
    cli,
    accountApiInfo,
    pod.email,
    pod.password
  );

  ////// Get WebID from account info /////
  const fullAccountApiInfo = await getAccountApiInfo(
    cli,
    accountApiInfo.controls.main.index,
    cookieHeader
  );
  if (!fullAccountApiInfo) {
    throw new Error(`Failed to fetch logged in account API info`);
  }

  cli.v2("Looking for WebID...");
  const accountInfo = await getAccountInfo(
    cli,
    cookieHeader,
    fullAccountApiInfo
  );
  const webIdUri = accountInfo.controls.account.webId; //Object.keys(accountInfo.webIds)[0];
  if (!webIdUri) {
    throw new Error(
      `Failed to find webId Uri in account info: ${JSON.stringify(
        accountInfo,
        null,
        3
      )}`
    );
  }

  cli.v2(`Fetching WebID info at ${webIdUri}`);
  const webIdInfoResp = await fetch(webIdUri, {
    method: "GET",
    headers: { Accept: "application/json", Cookie: cookieHeader },
  });
  cli.v3(
    `webIdInfoResp.ok`,
    webIdInfoResp.ok,
    `webIdInfoResp.status`,
    webIdInfoResp.status
  );
  if (!webIdInfoResp.ok) {
    console.error(`${webIdInfoResp.status} - Fetching webID info failed:`);
    const body = await webIdInfoResp.text();
    console.error(body);
    throw new ResponseError(webIdInfoResp, body);
  }
  const webIdInfo = await webIdInfoResp.json();
  /*
    Example content:
       {
         "fields": { "webId": { "required": true, "type": "string" } },
         "webIdLinks": {
              "https://n065-05.wall2.ilabt.iminds.be/user0/profile/card#me": "https://n065-05.wall2.ilabt.iminds.be/.account/account/5b3bf772-16f1-427b-926f-1958acd5fe61/webid/b6687e62-1b6f-49c2-a695-2f86d99cc4b2/"
         },
       ...
  */

  cli.v3(`webIdInfo`, webIdInfo);
  const webId = Object.keys((<any>webIdInfo)?.webIdLinks)[0];

  if (!webId) {
    throw new Error(
      `Failed to find webId in account info: ${JSON.stringify(
        webIdInfo,
        null,
        3
      )}`
    );
  }
  cli.v2("WebID found", webId);

  ////// Create Token (client credential) /////

  return await createClientCredential(
    cli,
    cookieHeader,
    webId,
    pod.username,
    fullAccountApiInfo
  );
}

export function stillUsableAccessToken(
  accessToken: AccessToken,
  deadline_s: number = 5 * 60
): boolean {
  if (!accessToken.token || !accessToken.expire) {
    return false;
  }
  const now = new Date().getTime();
  const expire = accessToken.expire.getTime();
  //accessToken.expire should be 5 minutes in the future at least
  return expire > now && expire - now > deadline_s * 1000;
}

export async function getUsableAccessToken(
  cli: CliArgsCommon,
  pod: PodAndOwnerInfo,
  token: UserToken,
  fetcher: AnyFetchType = fetch,
  accessTokenDurationCounter: DurationCounter | null = null,
  fetchDurationCounter: DurationCounter | null = null,
  generateDpopKeyPairDurationCounter: DurationCounter | null = null,
  accessToken: AccessToken | null = null,
  ensureAuthExpirationS: number = 30
): Promise<AccessToken> {
  //see https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/client-credentials.md
  const { id, secret } = token;

  let accessTokenDurationStart = null;
  try {
    if (
      accessToken === null ||
      !stillUsableAccessToken(accessToken, ensureAuthExpirationS)
    ) {
      const generateDpopKeyPairDurationStart = new Date().getTime();
      const dpopKeyPair = await generateDpopKeyPair();
      const authString = `${encodeURIComponent(id)}:${encodeURIComponent(
        secret
      )}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const url = `${pod.oidcIssuer}.oidc/token`; //ideally, fetch this from token_endpoint in .well-known/openid-configuration
      if (generateDpopKeyPairDurationCounter !== null) {
        generateDpopKeyPairDurationCounter.addDuration(
          new Date().getTime() - generateDpopKeyPairDurationStart
        );
      }

      accessTokenDurationStart = new Date().getTime();
      const res = await fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(authString).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          dpop: await createDpopHeader(url, "POST", dpopKeyPair),
        },
        body: "grant_type=client_credentials&scope=webid",
        signal: controller.signal,
      });

      const body = await res.text();
      clearTimeout(timeoutId);
      if (
        accessTokenDurationCounter !== null &&
        accessTokenDurationStart !== null
      ) {
        accessTokenDurationCounter.addDuration(
          new Date().getTime() - accessTokenDurationStart
        );
        accessTokenDurationStart = null;
      }

      if (!res.ok) {
        console.error(
          `${res.status} - Creating access token for ${pod.username} failed:`
        );
        console.error(body);
        throw new ResponseError(res, body);
      }

      const { access_token: accessTokenStr, expires_in: expiresIn } =
        JSON.parse(body);
      const expire = new Date(
        new Date().getTime() + parseInt(expiresIn) * 1000
      );
      accessToken = {
        token: accessTokenStr,
        expire: expire,
        dpopKeyPair: dpopKeyPair,
      };
      cli.v3(
        `Created Access Token using CSS token: \nusername=${pod.username}\n, id=${id}\n, secret=${secret}\n, expiresIn=${expiresIn}\n, accessToken=${accessTokenStr}`
      );

      if (!stillUsableAccessToken(accessToken, ensureAuthExpirationS)) {
        const msg =
          `AccessToken was refreshed, but is not valid long enough.` +
          `Must be valid for ${ensureAuthExpirationS}s, but is valid for ${expiresIn}s`;
        console.error(msg);
        throw new Error(msg);
      }
    }

    return accessToken;
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.error(`Fetching access token took too long: aborted`);
    }
    throw error;
  } finally {
    if (
      accessTokenDurationCounter !== null &&
      accessTokenDurationStart !== null
    ) {
      accessTokenDurationCounter.addDuration(
        new Date().getTime() - accessTokenDurationStart
      );
    }
  }
}

export async function getUserAuthFetch(
  cli: CliArgsCommon,
  pod: PodAndOwnerInfo,
  token: UserToken,
  fetcher: AnyFetchType = fetch,
  accessTokenDurationCounter: DurationCounter | null = null,
  fetchDurationCounter: DurationCounter | null = null,
  generateDpopKeyPairDurationCounter: DurationCounter | null = null,
  accessToken: AccessToken | null = null,
  ensureAuthExpirationS: number = 30
): Promise<[AnyFetchType, AccessToken]> {
  accessToken = await getUsableAccessToken(
    cli,
    pod,
    token,
    fetcher,
    accessTokenDurationCounter,
    fetchDurationCounter,
    generateDpopKeyPairDurationCounter,
    accessToken,
    ensureAuthExpirationS
  );

  const fetchDurationStart = new Date().getTime();
  try {
    const authFetch: AnyFetchType = await buildAuthenticatedFetch(
      // @ts-ignore
      fetcher,
      accessToken.token,
      { dpopKey: accessToken.dpopKeyPair }
    );

    return [authFetch, accessToken];
  } finally {
    if (fetchDurationCounter !== null) {
      fetchDurationCounter.addDuration(
        new Date().getTime() - fetchDurationStart
      );
    }
  }
}

export interface AuthHeaders {
  Authorization: string;
  DPoP: string;
}

export async function getFetchAuthHeaders(
  cli: CliArgsCommon,
  pod: PodAndOwnerInfo,
  method: "get" | "put" | "post" | "patch" | "delete",
  token: UserToken,
  fetcher: AnyFetchType = fetch,
  accessTokenDurationCounter: DurationCounter | null = null,
  fetchDurationCounter: DurationCounter | null = null,
  generateDpopKeyPairDurationCounter: DurationCounter | null = null,
  accessToken: AccessToken | null = null,
  ensureAuthExpirationS: number = 30
): Promise<[AuthHeaders, AccessToken]> {
  accessToken = await getUsableAccessToken(
    cli,
    pod,
    token,
    fetcher,
    accessTokenDurationCounter,
    fetchDurationCounter,
    generateDpopKeyPairDurationCounter,
    accessToken,
    ensureAuthExpirationS
  );
  const dpop = await createDpopHeader(
    pod.oidcIssuer,
    method,
    accessToken.dpopKeyPair
  );
  return [
    {
      Authorization: `DPoP ${accessToken.token}`,
      DPoP: dpop,
    },
    accessToken,
  ];
}
