import { ResponseError } from "../utils/error.js";
import { CliArgsCommon } from "../common/cli-args.js";

//see
// https://github.com/CommunitySolidServer/CommunitySolidServer/blob/main/documentation/markdown/usage/account/json-api.md

export interface AccountApiInfo {
  controls: {
    password?: {
      create?: string;
      forgot?: string;
      login?: string;
      reset?: string;
    };
    account: {
      create: string;
      clientCredentials?: string;
      pod?: string;
      webId?: string;
      logout?: string;
      account?: string;
    };
    main: {
      index: string;
      logins?: string;
    };
    html?: Object; //we don't care about this one
  };
  version: string; //"0.5"
}

export interface UserToken {
  id: string;
  secret: string;
}

export async function getAccountApiInfo(
  cli: CliArgsCommon,
  accountApiUrl: string,
  cookieHeader?: string
): Promise<AccountApiInfo | null> {
  const headers: any = { Accept: "application/json" };
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }
  const accountApiResp = await fetch(accountApiUrl, {
    method: "GET",
    headers,
  });

  cli.v3(
    `accountApiResp.ok`,
    accountApiResp.ok,
    `accountApiResp.status`,
    accountApiResp.status
  );

  if (accountApiResp.status == 404) {
    cli.v1(`404 fetching Account API at ${accountApiUrl}`);
    return null;
  }
  if (accountApiResp.ok) {
    const accountApiBody: AccountApiInfo = <AccountApiInfo>(
      await accountApiResp.json()
    );
    cli.v3(`Account API: ${JSON.stringify(accountApiBody, null, 3)}`);
    return accountApiBody;
  }
  return null;
}

export async function getAccountInfo(
  cli: CliArgsCommon,
  cookieHeader: string,
  fullAccountApiInfo: AccountApiInfo
): Promise<AccountApiInfo> {
  const accountInfoUrl = fullAccountApiInfo.controls?.main?.index;
  console.assert(
    accountInfoUrl && accountInfoUrl.startsWith("http"),
    "Problem with account info URL",
    accountInfoUrl
  );

  cli.v2(`Fetching account info`);
  const accountInfoResp = await fetch(accountInfoUrl, {
    method: "GET",
    headers: { Accept: "application/json", Cookie: cookieHeader },
  });

  cli.v3(
    `accountInfoResp.ok`,
    accountInfoResp.ok,
    `accountInfoResp.status`,
    accountInfoResp.status
  );

  if (!accountInfoResp.ok) {
    console.error(`${accountInfoResp.status} - Fetching account info failed:`);
    const body = await accountInfoResp.text();
    console.error(body);
    throw new ResponseError(accountInfoResp, body);
  }
  const accountInfoBody: AccountApiInfo = <AccountApiInfo>(
    await accountInfoResp.json()
  );
  cli.v3(`Account Info: ${JSON.stringify(accountInfoBody, null, 3)}`);
  return accountInfoBody;
}
