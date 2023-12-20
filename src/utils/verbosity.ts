import { CliArgsCommon } from "../common/cli-args";

export async function fetchWithLog<
  FetchType extends (arg0: any, arg1?: any) => Promise<any>
>(
  fetchFunction: FetchType,
  actionDescription: string,
  cli: CliArgsCommon,
  url: Parameters<FetchType>[0],
  init?: Parameters<FetchType>[1],
  log: boolean = true,
  extraHeaders?: () => Promise<Record<string, string>>
): Promise<Awaited<ReturnType<FetchType>>> {
  if (log && cli.verbosity_count >= 3) {
    const method = init?.method || "GET";
    const body = init?.body || "";
    const headers = JSON.stringify(
      {
        ...(init?.headers || {}),
        ...(extraHeaders ? await extraHeaders() : {}),
      },
      null,
      3
    );
    cli.v3(
      `FETCH request:\n   purpose='${actionDescription}'\n   method=${method}\n   url='${url}'\n   headers=${headers}\n   body='${body}'`
    );
  }
  const res = await fetchFunction(url, init);
  if (cli.verbosity_count >= 3) {
    const bodyLen = res?.headers?.get("content-length");
    const contentType = res?.headers?.get("content-type");
    cli.v3(
      `FETCH reply: status=${res.status} (${res.statusText}) content-type=${contentType} content-length=${bodyLen}`
    );
  }
  return res;
}
