import { CreateAccountMethod, MachineLoginMethod } from "../common/account";
import { getAccountApiInfo } from "../populate/css-accounts-api";
import { CliArgsCommon } from "../common/cli-args";

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
 *
 * @return the discovered CreateAccountMethod method and URI. If no way to create account, or unknown, returns [CreateAccountMethod.NONE, ''].
 */
export async function discoverCreateAccountTypeAndUri(
  cli: CliArgsCommon,
  serverBaseUrl: string,
  createAccountMethod?: CreateAccountMethod,
  createAccountUri?: string
): Promise<[CreateAccountMethod, string]> {
  const accountApiInfo = await getAccountApiInfo(
    cli,
    `${serverBaseUrl}.account/`
  );
  if (accountApiInfo && accountApiInfo?.controls?.account?.create) {
    cli.v2(`Account API confirms v7`);
    return [CreateAccountMethod.CSS_V7, `${serverBaseUrl}.account/`];
  }
  //TODO detect v1 or v6
  //GET https://pod.playground.solidlab.be/idp/ ?
  //GET https://pod.playground.solidlab.be/.account/ ?
  //https://pod.playground.solidlab.be/idp/register/ ?
  //https://pod.playground.solidlab.be/.account/register/ ?

  return [CreateAccountMethod.CSS_V6, "todo"];
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
  return [MachineLoginMethod.CSS_V7, "todo"];
}
