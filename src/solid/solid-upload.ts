import { ResponseError } from "../utils/error.js";
import { AnyFetchType } from "../utils/generic-fetch.js";
import { CONTENT_TYPE_ACL, CONTENT_TYPE_ACR } from "../utils/content-type.js";
import { makeAclContent } from "../authz/wac-acl.js";
import { makeAcrContent } from "../authz/acp-acr.js";
import { CliArgsPopulate } from "../populate/populate-args.js";
import { getAccountApiInfo } from "../solid/css-accounts-api.js";
import {
  AccountCreateOrder,
  CreateAccountMethod,
  MachineLoginMethod,
  PodAndOwnerInfo,
} from "../common/interfaces.js";
import { getServerBaseUrl } from "../utils/solid-server-detect.js";
import { createPodAccountsApi7 } from "./css-v7-accounts-api.js";
import { joinUri } from "../utils/uri_helper.js";
import { fetchWithLog } from "../utils/verbosity.js";
import { getFetchAuthHeadersFromAccessToken, PodAuth } from "./solid-auth.js";

/**
 *
 * @param {string} cli the cli arguments
 * @param {string} server the solid server
 * @param {string} accountCreateOrder The username/password used to create the account, and the podName (same value as you would give in the register form online)
 */
export async function createAccount(
  cli: CliArgsPopulate,
  accountCreateOrder: AccountCreateOrder
): Promise<PodAndOwnerInfo> {
  //We assume accountCreateOrder.createAccountMethod and accountCreateOrder.createAccountUri are correct at all time!
  //Our caller should have checked this.

  if (accountCreateOrder.createAccountMethod === CreateAccountMethod.CSS_V6) {
    return await createPodAccountsApi6(cli, accountCreateOrder);
  } else if (
    accountCreateOrder.createAccountMethod === CreateAccountMethod.CSS_V7
  ) {
    const accountApiInfo = await getAccountApiInfo(
      cli,
      accountCreateOrder.createAccountUri! //should not be undefined at this point
    );
    return await createPodAccountsApi7(
      cli,
      accountCreateOrder,
      accountApiInfo!
    );
  } else {
    throw Error(
      `CreateAccountMethod ${accountCreateOrder.createAccountMethod} is not supported`
    );
  }
}

export async function createPodAccountsApi6(
  cli: CliArgsPopulate,
  accountCreateOrder: AccountCreateOrder
): Promise<PodAndOwnerInfo> {
  if (!accountCreateOrder.createAccountUri) {
    throw Error("createAccountUri may not be empty");
  }

  //see https://communitysolidserver.github.io/CommunitySolidServer/6.x/usage/identity-provider/
  cli.v1(`Will create account "${accountCreateOrder.username}"...`);
  const settings = {
    podName: accountCreateOrder.podName,
    email: accountCreateOrder.email,
    password: accountCreateOrder.password,
    confirmPassword: accountCreateOrder.password,
    register: true,
    createPod: true,
    createWebId: true,
  };

  //TODO get from accountCreateOrder.createAccountUri
  const idpPath = accountCreateOrder.createAccountUri.includes("/idp/")
    ? "idp"
    : ".account"; //'idp' or '.account';
  const serverBaseUrl = getServerBaseUrl(accountCreateOrder.createAccountUri);

  console.assert(
    accountCreateOrder.createAccountUri.endsWith(`/idp/register/`) ||
      accountCreateOrder.createAccountUri.endsWith(`/.account/register/`)
  );
  cli.v2(`POSTing to: ${accountCreateOrder.createAccountUri}`);

  // @ts-ignore
  let res = await fetch(accountCreateOrder.createAccountUri, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(settings),
  });

  cli.v3(`res.ok`, res.ok, `res.status`, res.status);

  if (res.status == 404) {
    cli.v1(`${res.status} registering user: incompatible IdP path`);

    throw Error(`${res.status} registering user: incompatible IdP path`);
  }

  const body = await res.text();
  if (!res.ok) {
    if (body.includes("Account already exists")) {
      throw Error(`${res.status} registering user: Account already exists`);
    }

    if (body.includes("outside the configured identifier space")) {
      cli.v1(
        `error registering account ${accountCreateOrder.username} (${res.status} - ${body}): assuming incompatible IdP path`
      );

      throw Error(`${res.status} registering user: incompatible IdP path`);
    }

    console.error(
      `${res.status} - Creating pod for ${accountCreateOrder.username} failed:`
    );
    console.error(body);
    throw new ResponseError(res, body);
  }

  const jsonResponse = JSON.parse(body);
  cli.v3(`Created account info: ${JSON.stringify(jsonResponse, null, 3)}`);
  return {
    index: accountCreateOrder.index,
    webID: jsonResponse.webId, //`${cssBaseUrl}${account}/profile/card#me`,
    podUri: jsonResponse.podBaseUrl, //`${cssBaseUrl}${account}/`,
    username: accountCreateOrder.podName, //username is never passed to CSS in this version
    password: accountCreateOrder.password,
    email: accountCreateOrder.email,
    machineLoginMethod:
      accountCreateOrder.createAccountMethod == CreateAccountMethod.CSS_V6
        ? MachineLoginMethod.CSS_V6
        : MachineLoginMethod.NONE,
    machineLoginUri: `${serverBaseUrl}${idpPath}/credentials/`,
    oidcIssuer: serverBaseUrl,
  };
}

export async function uploadPodFile(
  cli: CliArgsPopulate,
  pod: PodAndOwnerInfo,
  fileContent: string | Buffer,
  podFileRelative: string,
  podAuth: PodAuth,
  contentType: string,
  debugLogging: boolean = false,
  retryAll: boolean = false,
  retryLimit: number = 5
) {
  let retry = true;
  let retryCount = 0;
  while (retry) {
    retry = false;
    if (debugLogging) {
      cli.v1(
        `Will upload file to account ${pod.username}, pod path "${podFileRelative}"`
      );
    }

    const targetUri = joinUri(pod.podUri, podFileRelative);
    const res = await fetchWithLog(
      podAuth.fetch,
      `Upload ${podFileRelative} (auth headers reconstructed)`,
      cli,
      targetUri,
      {
        method: "PUT",
        headers: { "content-type": contentType },
        body: fileContent,
      },
      debugLogging,
      async () => {
        return podAuth.accessToken
          ? await getFetchAuthHeadersFromAccessToken(
              cli,
              pod,
              "put",
              targetUri,
              podAuth.accessToken
            )
          : {};
      }
    );

    // console.log(`res.ok`, res.ok);
    // console.log(`res.status`, res.status);
    const body = await res.text();
    // console.log(`res.text`, body);
    if (!res.ok) {
      console.error(
        `${res.status} (${res.statusText}) - Uploading to ${targetUri} (account ${pod.username}, pod path "${podFileRelative}") failed:`
      );
      console.error(body);

      if ((res.status === 408 || retryAll) && retryCount < retryLimit) {
        retry = true;
        retryCount += 1;
        console.error(
          `Got ${res.status} (${res.statusText}). That's strange... Will retry. (max 5 times)`
        );
      } else {
        throw new ResponseError(res, body);
      }
    }
  }
}

function lastDotToSemi(input: string): string {
  //another dirty hack
  return input.replace(/.(\s*)$/, ";$1");
}

export async function addAuthZFiles(
  cli: CliArgsPopulate,
  pod: PodAndOwnerInfo,
  podAuth: PodAuth,
  targetFilename: string,
  publicRead: boolean = true,
  publicWrite: boolean = false,
  publicControl: boolean = false,
  debugLogging: boolean = false,
  addAclFiles: boolean = false,
  addAcrFiles: boolean = false,
  addAcFilePerResource: boolean = true,
  addAcFilePerDir: boolean = true,
  dirDepth: number = 0
) {
  const authZTypes: ("ACP" | "WAC")[] = [];
  if (addAclFiles) {
    authZTypes.push("WAC");
  }
  if (addAcrFiles) {
    authZTypes.push("ACP");
  }

  for (const authZType of authZTypes) {
    if (addAcFilePerDir) {
      //We always assume the .acr or .acl file at the pod root is already present.
      for (let curDepth = 1; curDepth < dirDepth + 1; curDepth++) {
        let targetDirName = ``;
        for (let i = 0; i < curDepth; i++) {
          targetDirName += "data/";
        }
        await addAuthZFile(
          cli,
          pod,
          podAuth,
          targetDirName,
          "",
          publicRead,
          publicWrite,
          publicControl,
          debugLogging,
          authZType,
          true
        );
      }
    }

    if (addAcFilePerResource) {
      let subDirs = ``;
      for (let i = 0; i < dirDepth; i++) {
        subDirs += "data/";
      }
      await addAuthZFile(
        cli,
        pod,
        podAuth,
        subDirs,
        targetFilename,
        publicRead,
        publicWrite,
        publicControl,
        debugLogging,
        authZType,
        false
      );
    }
  }
}

export async function addAuthZFile(
  cli: CliArgsPopulate,
  pod: PodAndOwnerInfo,
  podAuth: PodAuth,
  targetDirname: string, //dir of the file that needs AuthZ
  targetBaseFilename: string, //base name (without dir) of the file that needs AuthZ. For dirs, this is empty
  publicRead: boolean = true,
  publicWrite: boolean = false,
  publicControl: boolean = false,
  debugLogging: boolean = false,
  authZType: "ACP" | "WAC" = "ACP",
  isDir: boolean = false,
  retryAll: boolean = false,
  retryLimit: number = 5
) {
  let newAuthZContent;
  let fullPathPodFilename;
  let contentType;

  console.assert(
    targetDirname.length === 0 ||
      targetDirname.charAt(targetDirname.length - 1) === "/"
  );
  console.assert((targetBaseFilename.length === 0) === isDir);

  if (authZType == "WAC") {
    newAuthZContent = makeAclContent(
      pod,
      podAuth,
      targetBaseFilename,
      publicRead,
      publicWrite,
      publicControl,
      isDir
    );
    contentType = CONTENT_TYPE_ACL;
    fullPathPodFilename = `${targetDirname}${targetBaseFilename}.acl`; // Note: works for both isDir values
  } else {
    newAuthZContent = makeAcrContent(
      pod,
      podAuth,
      targetBaseFilename,
      publicRead,
      publicWrite,
      publicControl,
      isDir
    );
    contentType = CONTENT_TYPE_ACR;
    fullPathPodFilename = `${targetDirname}${targetBaseFilename}.acr`; // Note: works for both isDir values
  }

  await uploadPodFile(
    cli,
    pod,
    newAuthZContent,
    fullPathPodFilename,
    podAuth,
    contentType,
    debugLogging,
    retryAll,
    retryLimit
  );
}
