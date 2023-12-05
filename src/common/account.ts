import { readFile } from "node:fs/promises";
import { CliArgsCommon } from "./cli-args.js";
import {
  AccountCreateOrder,
  accountEmail,
  AccountSource,
  createAccountMethodStrings,
  MachineLoginMethodStrings,
  PodAndOwnerInfo,
} from "./interfaces.js";

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
      if (ui.machineLoginUri && !ui.machineLoginUri.startsWith("http")) {
        throw new Error(
          `File "${cli.accountSourceFile}" contains an entry with a machineLoginUri that is not an URL.`
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
        machineLoginUri: ui.machineLoginUri,
        podUri: ui.podUri,
      });
      index++;
    }
  } else {
    throw new Error(`Unsupported --account-source ${cli.accountSource}`);
  }
  return res;
}
