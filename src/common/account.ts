import { readFile } from "node:fs/promises";
import { CliArgsCommon, AccountSource } from "../common/cli-args";

export function accountEmail(account: string): string {
  return `${account}@example.org`;
}

export enum CreateAccountMethod {
  NONE = "NONE",
  CSS_V6 = "CSS_V6",
  CSS_V7 = "CSS_V7",
}
export type CreateAccountMethodStringsType = keyof typeof CreateAccountMethod;
export const createAccountMethodStrings: CreateAccountMethodStringsType[] = [
  "NONE",
  "CSS_V6",
  "CSS_V7",
];

export interface AccountCreateOrder {
  //Create a linked WebID, Idp and pod, using an identity provider solid server like CSS
  index: number;
  username: string;
  password: string;
  podName: string; //defaults to username
  email: string; //default based on username

  //AccountCreateOrder specific
  createAccountMethod?: CreateAccountMethod; //undefined if unknown, NONE if there is none. Default: try to auto detect.
  createAccountUri?: string; //for CSS, this is typically ${serverRootUri}/idp/register/ or ${serverRootUri}/.account/

  // webID?: string;  //this does not support using a custom preexisting WebID
}

export enum MachineLoginMethod {
  NONE = "NONE", //No way to login without user interaction
  CSS_V6 = "CSS_V6",
  CSS_V7 = "CSS_V7",
}
export type MachineLoginMethodStringsType = keyof typeof MachineLoginMethod;
export const MachineLoginMethodStrings: MachineLoginMethodStringsType[] = [
  "NONE",
  "CSS_V6",
  "CSS_V7",
];

export interface PodAndOwnerInfo {
  index: number;

  //Login info
  username: string;
  password: string;
  email: string; //default based on username

  //WebID
  webID: string; //This is typically a resource in pod, and for CSS this typically is ${serverRootUri}/${podName}/profile/card#me

  //Identity Provider (IdP)
  oidcIssuer: string; //uri
  machineLoginMethod?: MachineLoginMethod; //undefined if unknown, NONE if there is none
  machineLoginUri?: string; //for CSS, this is typically ${serverRootUri}/idp/credentials/ or ${serverRootUri}/.account/credentials/

  //pod
  // podName: string;  //info not really relevant or useful
  podUri: string; //for CSS, this is typically  ${serverRootUri}/${podName}/   (needs to end with /)
}

export async function getAccountCreateOrders(
  cli: CliArgsCommon
): Promise<AccountCreateOrder[]> {
  const res: AccountCreateOrder[] = [];
  if (cli.accountSource === AccountSource.Template) {
    for (let index = 0; index < cli.accountSourceCount; index++) {
      const username = cli.accountSourceTemplateUsername.replaceAll(
        "{{NR}}",
        `${index}`
      );
      res.push({
        username,
        password: cli.accountSourceTemplatePass.replaceAll(
          "{{NR}}",
          `${index}`
        ),
        podName: username,
        email: accountEmail(username),
        index,
        //TODO do auto-detect here! use URI, querying it if needed.
        createAccountMethod: cli.accountSourceTemplateCreateAccountMethod,
        createAccountUri: cli.accountSourceTemplateCreateAccountUri,
      });
    }
  } else if (cli.accountSource === AccountSource.File) {
    const providedAccountInfoFileContent = await readFile(
      cli.accountSourceFile || "error",
      { encoding: "utf8" }
    );
    const providedAccountInfoArr = JSON.parse(providedAccountInfoFileContent);
    if (!Array.isArray(providedAccountInfoArr)) {
      throw new Error(
        `File "${cli.accountSourceFile}" does not contain a JSON array.`
      );
    }
    let index = 0;
    for (const ui of providedAccountInfoArr) {
      if (!ui.username || !ui.password) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without username and/or password.`
        );
      }
      if (!ui.accountSourceTemplateCreateAccountMethod) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without accountSourceTemplateCreateAccountMethod.`
        );
      }
      if (!ui.accountSourceTemplateCreateAccountUri) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without accountSourceTemplateCreateAccountUri.`
        );
        //TODO if auto-detect is implemented above, just reuse it here
      }
      if (
        !createAccountMethodStrings.includes(
          ui.accountSourceTemplateCreateAccountMethod
        )
      ) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry with invalid accountSourceTemplateCreateAccountMethod: ${ui.accountSourceTemplateCreateAccountMethod}`
        );
      }
      if (ui.accountSourceTemplateCreateAccountMethod == "NONE") {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry with accountSourceTemplateCreateAccountUri: '${ui.accountSourceTemplateCreateAccountMethod}'. This means accounts cannot be created.`
        );
      }
      res.push({
        username: ui.username,
        password: ui.password,
        podName: ui.padName ?? ui.username,
        email: ui.email ?? accountEmail(ui.username),
        index,
        createAccountMethod: ui.accountSourceTemplateCreateAccountMethod,
        createAccountUri: ui.accountSourceTemplateCreateAccountUri,
      });
      index++;
    }
  } else {
    throw new Error(`Unsupported --account-source ${cli.accountSource}`);
  }
  return res;
}

export async function getExistingAccountsAndPods(
  cli: CliArgsCommon
): Promise<PodAndOwnerInfo[]> {
  const res: PodAndOwnerInfo[] = [];

  if (cli.accountSource === AccountSource.Template) {
    for (let index = 0; index < cli.accountSourceCount; index++) {
      function useTemplate(t: string): string {
        return t.replaceAll("{{NR}}", `${index}`);
      }

      const username = useTemplate(cli.accountSourceTemplateUsername);
      res.push({
        index,
        username,
        password: useTemplate(cli.accountSourceTemplatePass),
        email: accountEmail(username),

        webID: useTemplate(cli.accountSourceTemplateWebID!),

        oidcIssuer: useTemplate(cli.accountSourceTemplateOidcIssuer!),
        machineLoginMethod: undefined,
        machineLoginUri: undefined,
        podUri: useTemplate(cli.accountSourceTemplatePodUri!),
      });
    }
  } else if (cli.accountSource === AccountSource.File) {
    const providedAccountInfoFileContent = await readFile(
      cli.accountSourceFile || "error",
      { encoding: "utf8" }
    );
    const providedAccountInfoArr = JSON.parse(providedAccountInfoFileContent);
    if (!Array.isArray(providedAccountInfoArr)) {
      throw new Error(
        `File "${cli.accountSourceFile}" does not contain a JSON array.`
      );
    }
    let index = 0;
    for (const ui of providedAccountInfoArr) {
      if (!ui.username || !ui.password) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without username and/or password.`
        );
      }
      if (!ui.email) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without email.`
        );
      }
      if (!ui.webID) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without webID.`
        );
      }
      if (!ui.oidcIssuer) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without oidcIssuer.`
        );
      }
      if (!ui.podUri) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry without podUri.`
        );
      }
      if (
        ui.machineLoginMethod &&
        !MachineLoginMethodStrings.includes(ui.machineLoginMethod)
      ) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an machineLoginMethod with value "${ui.machineLoginMethod}"` +
            ` which is not one of ${MachineLoginMethodStrings.join(",")}.`
        );
      }
      res.push({
        index,
        username: ui.username,
        password: ui.password,
        email: ui.email,
        webID: ui.webID,
        oidcIssuer: ui.oidcIssuer,
        machineLoginMethod: ui.machineLoginMethod,
        machineLoginUri: undefined,
        podUri: ui.podUri,
      });
      index++;
    }
  } else {
    throw new Error(`Unsupported --account-source ${cli.accountSource}`);
  }
  return res;
}
