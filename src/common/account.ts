import { readFile } from "node:fs/promises";
import { CliArgsCommon, AccountSource } from "../common/cli-args";

export function accountEmail(account: string): string {
  return `${account}@example.org`;
}

export interface ProvidedAccountInfo {
  index: number;
  username: string;
  password: string;
  podName: string; //defaults to username
  email: string; //default based on username
  // webID?: string;  //not (yet?) relevant
}

export async function getAccounts(
  cli: CliArgsCommon
): Promise<ProvidedAccountInfo[]> {
  const providedAccountInfo: ProvidedAccountInfo[] = [];
  if (cli.accountSource === AccountSource.Template) {
    for (let index = 0; index < cli.accountSourceCount; index++) {
      const username = cli.accountSourceTemplateUsername.replaceAll(
        "{{NR}}",
        `${index}`
      );
      providedAccountInfo.push({
        username,
        password: cli.accountSourceTemplatePass.replaceAll(
          "{{NR}}",
          `${index}`
        ),
        podName: username,
        email: accountEmail(username),
        index,
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
      providedAccountInfo.push({
        username: ui.username,
        password: ui.password,
        podName: ui.padName ?? ui.username,
        email: ui.email ?? accountEmail(ui.username),
        index,
      });
      index++;
    }
  } else {
    throw new Error(`Unsupported --account-source ${cli.accountSource}`);
  }
  return providedAccountInfo;
}
