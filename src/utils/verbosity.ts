import { RequestInfo, RequestInit, Response } from "node-fetch";
import fetch from "node-fetch";
import { CliArgsCommon } from "../common/cli-args";

export async function fetchWithLog(
  actionDescription: string,
  cli: CliArgsCommon,
  url: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  if (cli.verbosity_count >= 3) {
    cli.v3(
      `FETCH request: \npurpose='${actionDescription}' \nmethod=${
        init?.method || "GET"
      } \nurl='${url}' \nheaders=${JSON.stringify(
        init?.headers || {},
        null,
        3
      )} \nbody='${init?.body || ""}'`
    );
  }
  const res = await fetch(url, init);
  if (cli.verbosity_count >= 3) {
    // const bodyLen = res?.headers?.get("content-type");
    const contentType = res?.headers?.get("content-type");
    cli.v3(
      `FETCH reply: status=${res.status} (${res.statusText}) content-type=${contentType}`
    );
  }
  return res;
}
