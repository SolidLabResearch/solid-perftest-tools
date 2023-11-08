import fetch from "node-fetch";
import { ResponseError } from "../utils/error.js";
import { AnyFetchType } from "../utils/generic-fetch.js";
import { CONTENT_TYPE_ACL, CONTENT_TYPE_ACR } from "../utils/content-type.js";
import { makeAclContent } from "../authz/wac-acl.js";
import { makeAcrContent } from "../authz/acp-acr.js";
import { CliArgsPopulate } from "../populate/populate-args.js";
import {
  AccountApiInfo,
  createAccountPod,
  createEmptyAccount,
  createPassword,
  getAccountApiInfo,
  getAccountInfo,
} from "../populate/css-accounts-api.js";
import {
  AccountCreateOrder,
  CreateAccountMethod,
  MachineLoginMethod,
  PodAndOwnerInfo,
} from "../common/interfaces.js";
import { getServerBaseUrl } from "../utils/solid-server-detect.js";

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

/**
 *
 * @param {string} cli CliArgs
 * @param {SolidServerInfo} server the solid server
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

  const cookieHeader = await createEmptyAccount(
    cli,
    accountCreateOrder,
    basicAccountApiInfo
  );
  if (!cookieHeader) {
    cli.v1(`404 registering user: incompatible Accounts API path`);
    throw Error(`404 registering user: incompatible IdP path`);
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

  const createdAccountInfo = await getAccountInfo(
    cli,
    cookieHeader,
    fullAccountApiInfo
  );

  if (!createdAccountInfo.webIds && !createdAccountInfo.webId) {
    throw Error(
      `error registering user: created account has no webID! account info: ${JSON.stringify(
        createdAccountInfo,
        null,
        3
      )}`
    );
  }
  const webId =
    createdAccountInfo.webId || Object.keys(createdAccountInfo.webIds)[0];

  if (!createdAccountInfo.pods && !createdAccountInfo.pod) {
    throw Error(
      `error registering user: created account has no pod! account info: ${JSON.stringify(
        createdAccountInfo,
        null,
        3
      )}`
    );
  }
  const pod = createdAccountInfo.pod || Object.keys(createdAccountInfo.pods)[0];

  const serverBaseUrl = getServerBaseUrl(accountCreateOrder.createAccountUri);
  return {
    index: accountCreateOrder.index,
    webID: webId,
    podUri: pod,
    username: accountCreateOrder.podName,
    password: accountCreateOrder.password,
    email: accountCreateOrder.email,
    machineLoginMethod: MachineLoginMethod.CSS_V7,
    machineLoginUri: `${serverBaseUrl}.account/credentials/`,
    oidcIssuer: serverBaseUrl,
  };
}

export async function uploadPodFile(
  cli: CliArgsPopulate,
  pod: PodAndOwnerInfo,
  fileContent: string | Buffer,
  podFileRelative: string,
  authFetch: AnyFetchType,
  contentType: string,
  debugLogging: boolean = false
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

    const res = await authFetch(`${pod.podUri}/${podFileRelative}`, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: fileContent,
    });

    // console.log(`res.ok`, res.ok);
    // console.log(`res.status`, res.status);
    const body = await res.text();
    // console.log(`res.text`, body);
    if (!res.ok) {
      console.error(
        `${res.status} - Uploading to account ${pod.username}, pod path "${podFileRelative}" failed:`
      );
      console.error(body);

      if (retryCount < 5) {
        retry = true;
        retryCount += 1;
        console.error(
          "Got 408 Request Timeout. That's strange... Will retry. (max 5 times)"
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

//OLD DIRTY FUNCTION (remove)
// export async function makeAclReadPublic(
//   cssBaseUrl: string,
//   account: string,
//   podFilePattern: string,
//   authFetch: AnyFetchType
// ) {
//   const aclContent = await downloadPodFile(
//     cssBaseUrl,
//     account,
//     ".acl",
//     authFetch
//   );
//
//   //Quick and dirty acl edit
//   let newAclContent = "";
//   let seenPublic = false;
//   let needsUpdate = true;
//   for (const line of aclContent.split(/\n/)) {
//     if (line.trim() === "<#public>") {
//       seenPublic = true;
//     }
//     if (seenPublic && line.includes(`acl:accessTo <./${podFilePattern}>`)) {
//       needsUpdate = false;
//       break;
//     }
//     if (seenPublic && line.includes(`acl:default <./>`)) {
//       needsUpdate = false;
//       break;
//     }
//     if (seenPublic && line.trim() === "") {
//       newAclContent = lastDotToSemi(newAclContent);
//       //doesn't work. So I don't see to understand this.
//       // newAclContent += `    acl:accessTo <./${podFilePattern}>;\n`;
//       // newAclContent += '    acl:mode acl:Read.\n';
//       //this works, but gives access to everything. Which is fine I guess.
//       newAclContent += `    acl:default <./>.\n`;
//       seenPublic = false;
//     }
//     newAclContent += line + "\n";
//   }
//
//   if (needsUpdate) {
//     // console.log("Replacing .acl with:\n" + newAclContent + "\n");
//     await uploadPodFile(cssBaseUrl, account, newAclContent, ".acl", authFetch);
//   } else {
//     // console.log(".acl already OK.\n");
//   }
// }

export async function addAuthZFiles(
  cli: CliArgsPopulate,
  pod: PodAndOwnerInfo,
  authFetch: AnyFetchType,
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
          authFetch,
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
        authFetch,
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
  authFetch: AnyFetchType,
  targetDirname: string, //dir of the file that needs AuthZ
  targetBaseFilename: string, //base name (without dir) of the file that needs AuthZ. For dirs, this is empty
  publicRead: boolean = true,
  publicWrite: boolean = false,
  publicControl: boolean = false,
  debugLogging: boolean = false,
  authZType: "ACP" | "WAC" = "ACP",
  isDir: boolean = false
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
      authFetch,
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
      authFetch,
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
    authFetch,
    contentType,
    debugLogging
  );
}
