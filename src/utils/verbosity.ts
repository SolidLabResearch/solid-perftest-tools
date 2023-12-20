import { CliArgsCommon } from "../common/cli-args";
import { AnyFetchType } from "./generic-fetch";

export async function fetchWithLog<FetchType extends AnyFetchType>(
  fetchFunction: FetchType,
  actionDescription: string,
  cli: CliArgsCommon,
  url: Parameters<FetchType>[0],
  init?: Parameters<FetchType>[1]
): Promise<Awaited<ReturnType<FetchType>>> {
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
  // @ts-ignore
  const res = await fetchFunction(url, init);
  if (cli.verbosity_count >= 3) {
    // const bodyLen = res?.headers?.get("content-type");
    const contentType = res?.headers?.get("content-type");
    cli.v3(
      `FETCH reply: status=${res.status} (${res.statusText}) content-type=${contentType}`
    );
  }
  // @ts-ignore
  return res;
}
