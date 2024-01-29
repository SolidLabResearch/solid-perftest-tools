#!/usr/bin/env node

import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import { CliArgsFlood, HttpVerb } from "./flood-args.js";
import { Counter, fetchPodFile } from "./flood-steps.js";
import { AnyFetchResponseType } from "../utils/generic-fetch.js";
import { discoverNotificationUri } from "../utils/solid-server-detect.js";
import { FloodState } from "./flood-state.js";

//spec: https://solidproject.org/TR/2022/notifications-protocol-20221231
//see also: https://communitysolidserver.github.io/CommunitySolidServer/6.x/usage/notifications/

interface NotificationsSubscription {
  userIndex: number;
  id: string;
  type: "websocket" | "webhook";
  topic: string;
  receiveFrom?: string;
  sendTo?: string;
}

interface NotificationsApiRequest {
  "@context": ["https://www.w3.org/ns/solid/notification/v1"];
  type:
    | "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023"
    | "http://www.w3.org/ns/solid/notifications#WebhookChannel2023";
  topic: string;
  sendTo?: string;
  startAt?: string;
  endAt?: string;
  rate?: string;
  accept?: string;
}

interface NotificationsApiReply {
  "@context": any;
  id: string;
  type:
    | "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023"
    | "http://www.w3.org/ns/solid/notifications#WebhookChannel2023";
  topic: string;
  receiveFrom?: string;
  sendTo?: string;
}

//The format in which notifications arrive at websockets or webhooks
interface Notification {
  "@context": any;
  id: string;
  type: "Create" | "Update" | "Delete" | "Add" | "Remove";
  object: string;
  state: string;
  published: string;
}

const notificationSubscriptions: NotificationsSubscription[] = [];

export async function stepNotificationsSubscribe(
  floodState: FloodState,
  cli: CliArgsFlood,
  counter: Counter
) {
  let curUserIndex = 0;
  for (let i = 0; i < cli.notificationSubscriptionCount; i++) {
    curUserIndex =
      curUserIndex + 1 >=
      Object.values(floodState.authFetchCache.accountInfos).length
        ? 0
        : curUserIndex + 1;

    const fetchTimeoutMs = 2000;
    try {
      const pod = floodState.authFetchCache.accountInfos[curUserIndex];
      const aFetch = await floodState.authFetchCache.getAuthFetcher(
        floodState.authFetchCache.accountInfos[curUserIndex]
      );
      const options: any = {
        method: "POST",
        // @ts-ignore
        signal: AbortSignal.timeout(fetchTimeoutMs),
      };

      //TODO: the .notifications/ URL is currently hardcoded. It is cleaner to find this URL automatically.
      //      See https://communitysolidserver.github.io/CommunitySolidServer/6.x/usage/notifications/
      const url = await discoverNotificationUri(
        pod.podUri,
        cli.notificationChannelType
      );
      options.headers = {
        "Content-type": "application/ld+json",
      };
      const notificationRequest: NotificationsApiRequest = {
        "@context": ["https://www.w3.org/ns/solid/notification/v1"],
        type: `http://www.w3.org/ns/solid/notifications#${
          cli.notificationChannelType === "websocket"
            ? "WebSocketChannel2023"
            : "WebhookChannel2023"
        }`,
        topic: `${pod.podUri}${cli.podFilename}`,
      };
      if (cli.notificationChannelType === "webhook") {
        notificationRequest.sendTo = cli.notificationWebhookTarget;
      }
      options.body = JSON.stringify(notificationRequest);
      const res: AnyFetchResponseType = await aFetch(url, options);

      cli.v2(
        `Notification subscribe reply code: ${res.status} ${res.statusText}`
      );

      if (!res.ok) {
        const bodyError = await res.text();
        const errorMessage =
          `${res.status} - Notification subscribe with account ${pod.username}, ` +
          `target ${notificationRequest.topic} URL "${url}" failed: ${bodyError}`;
        console.error(errorMessage);
        cli.v2(
          `Notification subscribe error. Debug info:\n   Request Body: \n${JSON.stringify(
            notificationRequest,
            null,
            3
          )} \n   Request Headers: `,
          options.headers
        );
        return;
      } else {
        const apiReply: NotificationsApiReply = <NotificationsApiReply>(
          (<unknown>await res.json)
        );
        const subscription: NotificationsSubscription = {
          userIndex: curUserIndex,
          id: apiReply.id,
          type: cli.notificationChannelType,
          topic: apiReply.topic,
          receiveFrom: apiReply.receiveFrom,
          sendTo: apiReply.sendTo,
        };
        notificationSubscriptions.push(subscription);
        cli.v1(`Subscribed to a notification for ${subscription.topic}`);
      }
    } catch (e: any) {
      cli.v2(`Notification subscribe error: will stop subscribing`);
      if (e.name === "AbortError") {
        console.error(
          `Notification subscription took longer than ${fetchTimeoutMs} ms: aborted`
        );
        return;
      }
      console.error(e);
      return;
    }
  }
}

export async function stepNotificationsConnectWebsockets(
  floodState: FloodState,
  cli: CliArgsFlood,
  counter: Counter
) {
  //TODO
  throw new Error("Not yet implemented");
}

export async function stepNotificationsDelete(
  floodState: FloodState,
  cli: CliArgsFlood,
  counter: Counter
) {
  const fetchTimeoutMs = 2000;
  for (const subscription of notificationSubscriptions) {
    try {
      const account = `user${subscription.userIndex}`;
      const aFetch = await floodState.authFetchCache.getAuthFetcher(
        floodState.authFetchCache.accountInfos[subscription.userIndex]
      );
      const options: any = {
        method: "DELETE",
        // @ts-ignore
        signal: AbortSignal.timeout(fetchTimeoutMs),
      };

      const res: AnyFetchResponseType = await aFetch(subscription.id, options);

      if (!res.ok) {
        const bodyError = await res.text();
        const errorMessage = `${res.status} - DELETE with account ${account}, URL "${subscription.id}" failed: ${bodyError}`;
        console.error(errorMessage);
        return;
      } else {
        cli.v1(`Unsubscribed to a notification for ${subscription.topic}`);
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        console.error(
          `Notification subscription delete took longer than ${fetchTimeoutMs} ms: aborted`
        );
        return;
      }
      console.error(e);
    }
  }
}
