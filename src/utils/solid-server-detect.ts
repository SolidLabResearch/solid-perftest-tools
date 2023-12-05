import {
  CreateAccountMethod,
  MachineLoginMethod,
} from "../common/interfaces.js";
import {
  AccountApiInfo,
  getAccountApiInfo,
} from "../solid/css-v7-accounts-api.js";
import { CliArgsCommon } from "../common/cli-args.js";
import fetch from "node-fetch";
import { dropDir, joinUri } from "./uri_helper.js";

/**
 * @param anyUri an URI of the target server
 * @return The URI of the server root, ending with /
 */
export function getServerBaseUrl(anyUri: string): string {
  //TODO use some library URI functionality to do this more clean
  return anyUri.replace(/(https?:\/\/[^\/]+\/).*/, "$1");
}

/**
 * @param anyUri an URI of the target server
 * @return The URI of the notification subscription endpoint
 */
export async function discoverNotificationUri(
  anyUri: string,
  notificationChannelType: "websocket" | "webhook"
): Promise<string> {
  //TODO: the .notifications/ URL is currently hardcoded. It is cleaner to find this URL automatically.
  //      See https://communitysolidserver.github.io/CommunitySolidServer/6.x/usage/notifications/

  const base = getServerBaseUrl(anyUri);
  return `${base}.notifications/${
    notificationChannelType === "websocket"
      ? "WebSocketChannel2023/"
      : "WebhookChannel2023/"
  }`;
}

/**
 * Try to discover which CreateAccountMethod is used by the server.
 * This will use the given createAccountMethod and createAccountUri and just return those if they look OK.
 * Otherwise, it will contact the server and try to find out.
 *
 * @param cli CLI args, mostly used for logging
 * @param serverBaseUrl the base URL of the server
 * @param createAccountMethod a hint if available
 * @param createAccountUri a hint if available
 * @param alwaysVerify if true, prefer to contact server each time for verification, even if sanity check passes.
 *
 * @return the discovered CreateAccountMethod method and URI. If no way to create account, or unknown, returns [CreateAccountMethod.NONE, ''].
 */
export async function discoverCreateAccountTypeAndUri(
  cli: CliArgsCommon,
  serverBaseUrl: string,
  createAccountMethod?: CreateAccountMethod,
  createAccountUri?: string,
  alwaysVerify: boolean = true
): Promise<[CreateAccountMethod, string]> {
  //TODO don't ignore createAccountMethod, createAccountUri and alwaysVerify
  //     these can make this work without server calls

  //Check V7
  const accountApiInfo = await getAccountApiInfo(
    cli,
    `${serverBaseUrl}.account/`
  );
  if (accountApiInfo?.controls?.account?.create) {
    cli.v3(
      `discoverCreateAccountTypeAndUri returns [CSS_V7, '${serverBaseUrl}.account/']`
    );
    return [CreateAccountMethod.CSS_V7, `${serverBaseUrl}.account/`];
  } else {
    if (accountApiInfo?.controls?.main?.logins) {
      cli.v3(
        `discoverCreateAccountTypeAndUri returns [CSS_V7, '${serverBaseUrl}.account/'] BUT account creation is probably not activated (no controls.account.create)!`
      );
      return [CreateAccountMethod.CSS_V7, `${serverBaseUrl}.account/`];
    } else {
      cli.v3(`not CSS_V7: no controls.account.create or controls.main.logins`);
    }
  }

  //Check V6
  //for V6, there is a body?.controls?.register endpoint, which V7 does not have.
  for (const idpUriPart of ["idp", ".account"]) {
    const discoverTryIdpUri = `${serverBaseUrl}${idpUriPart}/`;
    const discoverTryIdpResp = await fetch(discoverTryIdpUri, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    cli.v3(`discoverTryIdpResp.status`, discoverTryIdpResp.status);

    if (discoverTryIdpResp.ok) {
      const body: any = await discoverTryIdpResp.json();
      if (
        body?.controls?.register &&
        body?.controls?.register.startsWith("http")
      ) {
        cli.v3(
          `discoverCreateAccountTypeAndUri returns [CSS_V6, '${body?.controls?.register}']`
        );
        return [CreateAccountMethod.CSS_V6, body?.controls?.register];
      } else {
        cli.v1(
          `discoverCreateAccountTypeAndUri got unexpected reply on ${discoverTryIdpUri}, '${body?.controls?.register}']. ` +
            `Will assume not this version/uri.`
        );
      }
    } else {
      cli.v3(
        `not CSS_V6: ${discoverTryIdpResp.status} for ${discoverTryIdpUri}`
      );
    }

    //Note: For CSS v6, we get this
    //curl 'https://example.com/idp/' -X GET -H 'Accept: application/json'
    // {
    //   "apiVersion" : "0.4",
    //     "controls" : {
    //       "credentials" : "https://example.com/idp/credentials/",
    //       "forgotPassword" : "https://example.com/idp/forgotpassword/",
    //       "index" : "https://example.com/idp/",
    //       "login" : "https://example.com/idp/login/",
    //       "prompt" : "https://example.com/idp/prompt/",
    //       "register" : "https://example.com/idp/register/"
    //    }
    // }
  }

  cli.v1(
    `discoverCreateAccountTypeAndUri did not find any CreateAccountMethod.`
  );
  return [CreateAccountMethod.NONE, "error"];
}

/**
 * Try to discover which CreateAccountMethod is used by the server.
 * This will use the given createAccountMethod and createAccountUri and just return those if they look OK.
 * Otherwise, it will contact the server and try to find out.
 *
 * @param cli CLI args, mostly used for logging
 * @param serverBaseUrl the base URL of the server
 * @param machineLoginMethod a hint if available
 * @param machineLoginUri a hint if available
 *
 * @return the discovered MachineLoginMethod method and URI. If no way to create account, or unknown, returns [MachineLoginMethod.NONE, ''].
 */
export async function discoverMachineLoginTypeAndUri(
  cli: CliArgsCommon,
  serverBaseUrl: string,
  machineLoginMethod?: MachineLoginMethod,
  machineLoginUri?: string
): Promise<[MachineLoginMethod, string]> {
  //If both filled in, do sanity check and assume correct if it passes. Don't contact server.
  //    (Reason: In most cases, this info comes from populate and will be correct)
  //
  //If not sane, or either method or uri not filled in, query server to find out which method will work

  //TODO implement. See createUserToken in sold-auth.js

  //Check V7
  let candidateUrls = [`${serverBaseUrl}.account/`];
  if (machineLoginUri) {
    candidateUrls.push(machineLoginUri);
    //TODO drop dirs to root, adding account each time

    let maxDepth = 3;

    let last = machineLoginUri;
    candidateUrls.push(joinUri(last, ".account/"));
    let next = dropDir(last);
    while (last != next && maxDepth-- > 0 && next != serverBaseUrl) {
      candidateUrls.push(joinUri(next, ".account/"));
      next = dropDir(next);
    }
  }
  for (const candidateUrl of candidateUrls) {
    cli.v3(
      `discoverMachineLoginTypeAndUri CSS_V7 test will test '${candidateUrl}'`
    );
    const accountApiInfo: AccountApiInfo | null = await getAccountApiInfo(
      cli,
      candidateUrl
    );
    if (accountApiInfo?.controls?.account?.create) {
      cli.v3(
        `discoverMachineLoginTypeAndUri returns [CSS_V7, '${candidateUrl}']`
      );
      return [MachineLoginMethod.CSS_V7, candidateUrl];
    }
  }

  //Check V6
  //for V6, there is a body?.controls?.credentials endpoint, which V7 does not have.
  for (const idpUriPart of ["idp", ".account"]) {
    candidateUrls = [`${serverBaseUrl}${idpUriPart}/`];
    if (machineLoginUri) {
      candidateUrls.push(machineLoginUri);
      //TODO drop dirs to root, adding account each time

      let maxDepth = 3;

      let last = machineLoginUri;
      candidateUrls.push(joinUri(last, `${idpUriPart}/`));
      let next = dropDir(last);
      while (last != next && maxDepth-- > 0 && next != serverBaseUrl) {
        candidateUrls.push(joinUri(next, `${idpUriPart}/`));
        next = dropDir(next);
      }
    }
    for (const discoverTryIdpUri of candidateUrls) {
      cli.v3(
        `discoverMachineLoginTypeAndUri CSS_V6 test will test '${discoverTryIdpUri}'`
      );
      const discoverTryIdpResp = await fetch(discoverTryIdpUri, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      cli.v3(`discoverTryIdpResp.status`, discoverTryIdpResp.status);

      if (discoverTryIdpResp.ok) {
        const body: any = await discoverTryIdpResp.json();
        if (
          body?.controls?.credentials &&
          body?.controls?.credentials.startsWith("http")
        ) {
          cli.v3(
            `discoverMachineLoginTypeAndUri returns [CSS_V6, '${body?.controls?.credentials}']`
          );
          return [MachineLoginMethod.CSS_V6, body?.controls?.credentials];
        } else {
          cli.v1(
            `discoverMachineLoginTypeAndUri got unexpected reply on ${discoverTryIdpUri}, '${body?.controls?.credentials}']. ` +
              `Will assume not this version/uri.`
          );
        }
      }

      //Note: For CSS v6, we get this
      //curl 'https://example.com/idp/' -X GET -H 'Accept: application/json'
      // {
      //   "apiVersion" : "0.4",
      //     "controls" : {
      //       "credentials" : "https://example.com/idp/credentials/",
      //       "forgotPassword" : "https://example.com/idp/forgotpassword/",
      //       "index" : "https://example.com/idp/",
      //       "login" : "https://example.com/idp/login/",
      //       "prompt" : "https://example.com/idp/prompt/",
      //       "register" : "https://example.com/idp/register/"
      //    }
      // }
    }
  }

  cli.v1(
    `discoverMachineLoginTypeAndUri did not find any CreateAccountMethod.`
  );
  return [MachineLoginMethod.NONE, "error"];
}
