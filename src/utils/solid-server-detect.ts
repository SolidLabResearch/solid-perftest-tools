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
export function getNotificationUri(
  anyUri: string,
  notificationChannelType: "websocket" | "webhook"
): string {
  //TODO: the .notifications/ URL is currently hardcoded. It is cleaner to find this URL automatically.
  //      See https://communitysolidserver.github.io/CommunitySolidServer/6.x/usage/notifications/

  const base = getServerBaseUrl(anyUri);
  return `${base}.notifications/${
    notificationChannelType === "websocket"
      ? "WebSocketChannel2023/"
      : "WebhookChannel2023/"
  }`;
}
