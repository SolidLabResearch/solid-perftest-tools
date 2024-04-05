import { CliArgsPopulate } from "../populate/populate-args.js";
import {
  AccountCreateOrder,
  MachineLoginMethod,
  PodAndOwnerInfo,
} from "../common/interfaces.js";
import { getServerBaseUrl } from "../utils/solid-server-detect.js";
import { ResponseError } from "../utils/error.js";
import { CliArgsCommon } from "../common/cli-args.js";
import { fetchWithLog } from "../utils/verbosity.js";
import {
  AccountApiInfo,
  getAccountApiInfo,
  getAccountInfo,
  UserToken,
} from "./css-accounts-api.js";
import assert from "node:assert";

//see
// https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/account/json-api.md

export async function accountLogin(
  cli: CliArgsCommon,
  accountApiInfo: AccountApiInfo,
  email: string,
  password: string
): Promise<string> {
  cli.v2("Logging in...");
  const loginEndpoint = accountApiInfo.controls?.password?.login;
  if (!loginEndpoint) {
    throw new Error(
      `accountApiInfo.controls?.password?.login should not be empty`
    );
  }
  const loginObj = {
    email,
    password,
  };

  cli.v2(`POSTing to: ${loginEndpoint}`);
  const loginResp = await fetch(loginEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(loginObj),
  });
  cli.v3(`loginResp.ok`, loginResp.ok, `loginResp.status`, loginResp.status);
  if (!loginResp.ok) {
    console.error(`${loginResp.status} - failed to login:`);
    const body = await loginResp.text();
    console.error(body);
    throw new ResponseError(loginResp, body);
  }
  const cookies = [];
  for (const [k, v] of loginResp.headers.entries()) {
    if (k.toLowerCase() === "set-cookie") {
      cookies.push(v);
    }
  }
  const cookieHeader = cookies
    .map((c) =>
      c.substring(0, c.indexOf(";") == -1 ? undefined : c.indexOf(";"))
    )
    .reduce((a, b) => a + "; " + b);
  cli.v3("Got cookie", cookieHeader);
  return cookieHeader;
}

export async function createClientCredential(
  cli: CliArgsCommon,
  cookieHeader: string,
  webId: string,
  username: string,
  fullAccountApiInfo: AccountApiInfo
): Promise<UserToken> {
  cli.v2("Creating Client Credential...");
  const clientCredentialsEndpoint =
    fullAccountApiInfo.controls?.account?.clientCredentials;
  if (!clientCredentialsEndpoint) {
    throw new Error(
      `fullAccountApiInfo.controls.account.clientCredentials should not be empty`
    );
  }
  //see https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/client-credentials.md
  const startTime = new Date().getTime();
  let res = null;
  let body = null;
  let retryCount = 0;
  let tryAgain = true;
  while (tryAgain) {
    tryAgain = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      res = await fetchWithLog(
        fetch,
        "Creating Client Credential",
        cli,
        clientCredentialsEndpoint,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            webId: webId,
          }),
          signal: controller.signal,
        }
      );

      body = await res.text();
    } catch (error: any) {
      if (error.name === "AbortError") {
        if (retryCount < 5) {
          console.error(
            `Creating Client Credential took too long: aborted. Will try again.`
          );
          tryAgain = true;
          retryCount++;
        } else {
          console.error(`Creating Client Credential took too long: aborted`);
          throw error;
        }
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  assert(res !== null);
  assert(body !== null);

  if (!res || !res.ok) {
    console.error(
      `${res.status} - Creating Client Credential for ${username} failed:`,
      body
    );
    throw new ResponseError(res, body);
  }

  const { id, secret } = JSON.parse(body);
  return { id, secret };
}

export async function createEmptyAccount(
  cli: CliArgsCommon,
  accountInfo: AccountCreateOrder,
  basicAccountApiInfo: AccountApiInfo
): Promise<string | null> {
  const accountCreateEndpoint = basicAccountApiInfo?.controls?.account?.create;

  cli.v2(`Creating Account...`);
  cli.v2(`POSTing to: ${accountCreateEndpoint}`);
  let resp = await fetchWithLog(
    fetch,
    "Creating Account",
    cli,
    accountCreateEndpoint,
    {
      method: "POST",
      headers: { Accept: "application/json" },
      body: null,
    }
  );

  if (resp.status == 404) {
    cli.v1(`404 registering user: incompatible IdP path`);
    return null;
  }
  if (!resp.ok) {
    console.error(
      `${resp.status} - Creating account for ${accountInfo.username} failed:`
    );
    const body = await resp.text();
    console.error(body);
    throw new ResponseError(resp, body);
  }

  //reply contains:
  //   - cookie(s) (auth)
  //   - resource field with account url

  const createAccountBody: any = await resp.json();
  // const accountUrl: string | undefined = createAccountBody?.resource;
  const cookies = [];
  for (const [k, v] of resp.headers.entries()) {
    if (k.toLowerCase() === "set-cookie") {
      cookies.push(v);
    }
  }
  const cookieHeader = cookies
    .map((c) =>
      c.substring(0, c.indexOf(";") == -1 ? undefined : c.indexOf(";"))
    )
    .reduce((a, b) => a + "; " + b);

  // if (!accountUrl || !accountUrl.startsWith("http")) {
  //   console.error(
  //     `Creating account for ${
  //       accountInfo.username
  //     } failed: no resource in response: ${JSON.stringify(
  //       createAccountBody,
  //       null,
  //       3
  //     )}`
  //   );
  //   throw new ResponseError(resp, createAccountBody);
  // }
  if (!cookies) {
    console.error(
      `Creating account for ${
        accountInfo.username
      } failed: no cookies in response. headers: ${JSON.stringify(
        resp.headers,
        null,
        3
      )}`
    );
    throw new ResponseError(resp, createAccountBody);
  }
  return cookieHeader;
}

export async function createPassword(
  cli: CliArgsCommon,
  cookieHeader: string,
  account: string,
  email: string,
  password: string,
  fullAccountApiInfo: AccountApiInfo
): Promise<boolean> {
  cli.v2(`Creating password...`);

  const passCreateEndpoint = fullAccountApiInfo?.controls?.password?.create;
  cli.v2(`Account API gave passCreateEndpoint: ${passCreateEndpoint}`);
  if (!passCreateEndpoint) {
    throw new Error(
      `fullAccountApiInfo?.controls?.password?.create should not be empty`
    );
  }

  const createPassObj = {
    email,
    password,
  };

  cli.v2(`POSTing to: ${passCreateEndpoint}`);
  const passCreateResp = await fetchWithLog(
    fetch,
    "Creating password",
    cli,
    passCreateEndpoint,
    {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(createPassObj),
    }
  );
  cli.v3(
    `passCreateResp.ok`,
    passCreateResp.ok,
    `passCreateResp.status`,
    passCreateResp.status
  );

  if (!passCreateResp.ok) {
    const body = await passCreateResp.text();
    // if (body.includes("There already is a login for this e-mail address.")) {
    if (body.includes("already is a login for")) {
      cli.v1(
        `${passCreateResp.status} - User ${account} already exists, will ignore. Msg:`,
        body
      );
      //ignore
      return false;
    }
    console.error(
      `${passCreateResp.status} - Creating password for ${account} failed:`
    );
    console.error(body);
    throw new ResponseError(passCreateResp, body);
  }

  return true;
}

export async function createAccountPod(
  cli: CliArgsCommon,
  cookieHeader: string,
  podName: string,
  fullAccountApiInfo: AccountApiInfo
): Promise<boolean> {
  cli.v2(`Creating Pod + WebID...`);

  const podCreateEndpoint = fullAccountApiInfo?.controls?.account?.pod;
  cli.v2(`Account API gave podCreateEndpoint: ${podCreateEndpoint}`);
  if (!podCreateEndpoint) {
    throw new Error(
      `fullAccountApiInfo.controls.account.pod should not be empty`
    );
  }

  const podCreateObj = {
    name: podName,

    //  "If no WebID value is provided, a WebID will be generated in the pod and immediately linked to the
    //  account as described in controls.account.webID. This WebID will then be the WebID that has initial access."

    // settings: {  webId: 'custom'},
  };

  cli.v2(`POSTing to: ${podCreateEndpoint}`);
  const podCreateResp = await fetchWithLog(
    fetch,
    "Creating Pod + WebID",
    cli,
    podCreateEndpoint,
    {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(podCreateObj),
    }
  );
  cli.v3(
    `podCreateResp.ok`,
    podCreateResp.ok,
    `podCreateResp.status`,
    podCreateResp.status
  );

  if (!podCreateResp.ok) {
    console.error(
      `${podCreateResp.status} - Creating Pod & WebID for ${podName} failed:`
    );
    const body = await podCreateResp.text();
    console.error(body);
    throw new ResponseError(podCreateResp, body);
  }
  return true;
}

/**
 *
 * @param {string} cli CliArgs
 * @param {string} cookieHeader The auth cookie header
 * @param {string} accountInfo AccountApiInfo (not logged in)
 */
export async function getWebIDs(
  cli: CliArgsCommon,
  cookieHeader: string,
  accountInfo: AccountApiInfo
): Promise<string[]> {
  const webIdUri = accountInfo.controls.account.webId;
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
  const webIdInfoResp = await fetchWithLog(
    fetch,
    "Fetching WebID info",
    cli,
    webIdUri,
    {
      method: "GET",
      headers: { Accept: "application/json", Cookie: cookieHeader },
    }
  );
  cli.v3(
    `webIdInfoResp.ok`,
    webIdInfoResp.ok,
    `webIdInfoResp.status`,
    webIdInfoResp.status
  );
  if (!webIdInfoResp.ok) {
    console.error(`${webIdInfoResp.status} - Fetching WebID info failed:`);
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
  const webIds = Object.keys((<any>webIdInfo)?.webIdLinks);

  if (webIds.length === 0) {
    throw new Error(
      `no WebIDs found: webIdInfo=${JSON.stringify(webIdInfo, null, 3)}`
    );
  }

  return webIds;
}

/**
 *
 * @param {string} cli CliArgs
 * @param {string} cookieHeader The auth cookie header
 * @param {string} accountInfo AccountApiInfo (not logged in)
 */
export async function getPods(
  cli: CliArgsCommon,
  cookieHeader: string,
  accountInfo: AccountApiInfo
): Promise<string[]> {
  const podUri = accountInfo.controls.account.pod;
  if (!podUri) {
    throw new Error(
      `Failed to find pod Uri in account info: ${JSON.stringify(
        accountInfo,
        null,
        3
      )}`
    );
  }

  cli.v2(`Fetching Pod info at ${podUri}`);
  const podInfoResp = await fetchWithLog(
    fetch,
    "Fetching Pod info",
    cli,
    podUri,
    {
      method: "GET",
      headers: { Accept: "application/json", Cookie: cookieHeader },
    }
  );
  cli.v3(
    `podInfoResp.ok`,
    podInfoResp.ok,
    `podInfoResp.status`,
    podInfoResp.status
  );
  if (!podInfoResp.ok) {
    console.error(`${podInfoResp.status} - Fetching pod info failed:`);
    const body = await podInfoResp.text();
    console.error(body);
    throw new ResponseError(podInfoResp, body);
  }
  const podInfo = await podInfoResp.json();
  /*
      Example content:
         {
           "pods": {
                "http://localhost:3000/test/": "http://localhost:3000/.account/account/c63c9e6f-48f8-40d0-8fec-238da893a7f2/pod/df2d5a06-3ecd-4eaf-ac8f-b88a8579e100/"
           },
         ...
    */

  cli.v3(`podInfo`, podInfo);
  const pods = Object.keys((<any>podInfo)?.pods);

  if (pods.length === 0) {
    throw new Error(
      `no pods found: podInfo=${JSON.stringify(podInfo, null, 3)}`
    );
  }

  return pods;
}

/**
 *
 * @param {string} cli CliArgs
 * @param {string} accountCreateOrder The info used to create the account (same value as you would give in the register form online)
 * @param {string} basicAccountApiInfo AccountApiInfo (not logged in)
 */
export async function createPodAccountsApi7(
  cli: CliArgsPopulate,
  accountCreateOrder: AccountCreateOrder,
  basicAccountApiInfo: AccountApiInfo
): Promise<PodAndOwnerInfo> {
  if (!accountCreateOrder.createAccountUri) {
    throw Error("createAccountUri may not be empty");
  }

  let cookieHeader = null;
  let accountAlreadyExisted = false;
  try {
    // FIRST, check if the account already exists.
    cookieHeader = await accountLogin(
      cli,
      basicAccountApiInfo,
      accountCreateOrder.email,
      accountCreateOrder.password
    );
    // No error! So this account already exists
    accountAlreadyExisted = true;
  } catch (e) {
    // As expected, an error because account does not yet exist.
    // So we should just ignore this error
    accountAlreadyExisted = false;
    cli.v3(`As expected, account does not yet exists.`);

    //Create the account
    cookieHeader = await createEmptyAccount(
      cli,
      accountCreateOrder,
      basicAccountApiInfo
    );
    if (!cookieHeader) {
      cli.v1(`404 registering user: incompatible Accounts API path`);
      throw Error(`404 registering user: incompatible IdP path`);
    }
  }

  //We have an account now! And the cookies to use it.

  cli.v2(`Fetching account endpoints...`);
  const fullAccountApiInfo = await getAccountApiInfo(
    cli,
    basicAccountApiInfo.controls.main.index,
    cookieHeader
  );
  if (!fullAccountApiInfo) {
    throw Error(`error registering user: missing .account api info`);
  }
  if (!fullAccountApiInfo.controls?.password?.create) {
    cli.v1(`Account API is missing expected fields`);
    throw Error(`error registering user: incompatible .account api info`);
  }

  if (!accountAlreadyExisted) {
    /// Create a password for the account ////
    const passwordCreated = await createPassword(
      cli,
      cookieHeader,
      accountCreateOrder.username,
      accountCreateOrder.email,
      accountCreateOrder.password,
      fullAccountApiInfo
    );
    if (!passwordCreated) {
      //user already existed. We ignore that.
      throw Error(`error registering user: user already exists`);
    }

    /// Create a pod and link the WebID in it ////
    const createdPod = await createAccountPod(
      cli,
      cookieHeader,
      accountCreateOrder.podName,
      fullAccountApiInfo
    );
    if (!createdPod) {
      //pod not created
      throw Error(`error registering user: failed to create pod`);
    }
  }

  const createdAccountInfo = await getAccountInfo(
    cli,
    cookieHeader,
    fullAccountApiInfo
  );

  if (
    // !createdAccountInfo.webIds &&
    !createdAccountInfo?.controls?.account?.webId
  ) {
    throw Error(
      `error registering user: created account has no webID! account info: ${JSON.stringify(
        createdAccountInfo,
        null,
        3
      )}`
    );
  }
  const webId = (await getWebIDs(cli, cookieHeader, createdAccountInfo))[0];

  if (
    //!createdAccountInfo.pods &&
    !createdAccountInfo?.controls?.account?.pod
  ) {
    throw Error(
      `error registering user: created account has no pod! account info: ${JSON.stringify(
        createdAccountInfo,
        null,
        3
      )}`
    );
  }
  const pod = (await getPods(cli, cookieHeader, createdAccountInfo))[0];

  const serverBaseUrl = getServerBaseUrl(accountCreateOrder.createAccountUri);
  return {
    index: accountCreateOrder.index,
    webID: webId,
    podUri: pod,
    username: accountCreateOrder.podName,
    password: accountCreateOrder.password,
    email: accountCreateOrder.email,
    machineLoginMethod: MachineLoginMethod.CSS_V7,
    machineLoginUri: createdAccountInfo.controls?.main?.index, //for V7, the machineLoginUri is the .account URI  //less generic: `${serverBaseUrl}.account/`,
    oidcIssuer: serverBaseUrl,
  };
}
