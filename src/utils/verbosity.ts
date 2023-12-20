import { CliArgsCommon } from "../common/cli-args";

export async function fetchWithLog<
  FetchType extends (arg0: any, arg1?: any) => Promise<any>
>(
  fetchFunction: FetchType,
  actionDescription: string,
  cli: CliArgsCommon,
  url: Parameters<FetchType>[0],
  init?: Parameters<FetchType>[1],
  log: boolean = true
): Promise<Awaited<ReturnType<FetchType>>> {
  if (log && cli.verbosity_count >= 3) {
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
  const res = await fetchFunction(url, init);
  if (cli.verbosity_count >= 3) {
    // const bodyLen = res?.headers?.get("content-type");
    const contentType = res?.headers?.get("content-type");
    cli.v3(
      `FETCH reply: status=${res.status} (${res.statusText}) content-type=${contentType}`
    );
  }
  return res;
}
