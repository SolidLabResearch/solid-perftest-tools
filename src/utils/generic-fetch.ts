import nodeFetch from "node-fetch";
import {
  Response as NodeFetchResponse,
  RequestInfo as NodeFetchRequestInfo,
  RequestInit as NodeFetchRequestInit,
} from "node-fetch";

export type AnyFetchType = typeof fetch | typeof nodeFetch;
export type AnyFetchResponseType = Response | NodeFetchResponse;
export type AnyFetchRequestInfo = URL | RequestInfo | NodeFetchRequestInfo;
export type AnyFetchRequestInit = RequestInit | NodeFetchRequestInit;
export type AnyFetchFunctionType =
  | ((input: RequestInfo, init?: RequestInit | undefined) => Promise<Response>)
  | ((
      input: NodeFetchRequestInfo,
      init?: NodeFetchRequestInit | undefined
    ) => Promise<NodeFetchResponse>);

const nodeMajorVersion = parseInt(
  process.version.substring(1, process.version.indexOf("."))
);

//only in nodejs 18!
export const es6fetch = nodeMajorVersion >= 18 ? fetch : nodeFetch;
