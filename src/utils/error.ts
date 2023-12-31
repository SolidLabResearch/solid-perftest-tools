import { AnyFetchResponseType } from "./generic-fetch.js";

export class ResponseError extends Error {
  constructor(response: AnyFetchResponseType, responseBody: string) {
    const shortResponseBody =
      responseBody.length > 150
        ? responseBody.substring(0, 150) + "..."
        : responseBody;
    const message = `Error, got HTTP ${response.status} ${response.statusText}: ${shortResponseBody}`;
    super(message); // 'Error' breaks prototype chain here
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}
