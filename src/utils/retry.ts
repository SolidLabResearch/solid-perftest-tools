import { CliArgsPopulate } from "../populate/populate-args";
import { PodAndOwnerInfo } from "../common/interfaces";
import {
  getFetchAuthHeadersFromAccessToken,
  PodAuth,
} from "../solid/solid-auth";
import { joinUri } from "./uri_helper";
import { fetchWithLog } from "./verbosity";
import { setTimeout } from "timers/promises";
import { ResponseError } from "./error";
import { Body } from "node-fetch";
import { AnyFetchResponseType } from "./generic-fetch";
import { CliArgsCommon } from "../common/cli-args";

export async function anyFetchWithRetry<Fetcher extends () => Promise<any>>(
  cli: CliArgsCommon,
  doFetch: Fetcher,
  description: string,

  debugLogging: boolean = false,
  retryAll: boolean = false,
  retryLimit: number = 5
): Promise<Awaited<ReturnType<Fetcher>>> {
  let retry = true;
  let retryCount = 0;
  while (retry) {
    retry = false;
    if (debugLogging) {
      cli.v1(`Start ${description}"`);
    }

    let res;
    try {
      res = await doFetch();
      if (res.ok) {
        return res;
      }
    } catch (e) {
      if (retryAll && retryCount < retryLimit) {
        retry = true;
        retryCount += 1;
        console.error(
          `Got Exception '${e}' ${description}. That's strange... Will retry (#${retryCount} of max ${retryLimit}).`,
          e
        );
        await setTimeout(100 * retryCount);
        continue;
      } else {
        if (retryCount)
          console.error(
            `Got Exception '${e}' ${description}. Already retried ${retryCount} times. Giving up.`
          );
        else
          console.error(`Got Exception '${e}' ${description}. Retry disabled.`);
        throw e;
      }
    }

    if (res) {
      // console.log(`res.ok`, res.ok);
      // console.log(`res.status`, res.status);
      const body = await res.text();
      // console.log(`res.text`, body);

      console.error(
        `${res.status} (${res.statusText}) - ${description} failed:`
      );
      console.error(body);

      if ((res.status === 408 || retryAll) && retryCount < retryLimit) {
        retry = true;
        retryCount += 1;
        console.error(
          `Got ${res.status} (${res.statusText}) when ${description}. That's strange... Will retry (#${retryCount} of max ${retryLimit}).`
        );
        await setTimeout(100 * retryCount);
      } else {
        if (retryCount)
          console.error(
            `Got ${res.status} (${res.statusText}) when ${description}}. Already retried ${retryCount} times. Giving up.`
          );
        else
          console.error(
            `Got ${res.status} (${res.statusText}) when ${description}. Retry disabled.`
          );
        throw new ResponseError(res, body);
      }
    } else {
      //should not occur
      throw new Error("Unexpected state");
    }
  }
  //should not occur
  throw new Error("Unexpected state");
}

export async function fetchWithRetryAndLog<
  FetchType extends (arg0: any, arg1?: any) => Promise<any>
>(
  fetchFunction: FetchType,
  actionDescription: string,
  cli: CliArgsCommon,
  url: Parameters<FetchType>[0],
  init?: Parameters<FetchType>[1],
  log: boolean = true,
  extraHeaders?: () => Promise<Record<string, string>>,

  retryAll: boolean = false,
  retryLimit: number = 5
): Promise<Awaited<ReturnType<FetchType>>> {
  return anyFetchWithRetry(
    cli,
    () =>
      fetchWithLog(
        fetchFunction,
        actionDescription,
        cli,
        url,
        init,
        log,
        extraHeaders
      ),
    actionDescription,
    log,
    retryAll,
    retryLimit
  );
}
