import {
  AccessToken,
  createUserToken,
  getFetchAuthHeaders,
  getFetchAuthHeadersFromAccessToken,
  getUserAuthFetch,
  PodAuth,
  stillUsableAccessToken,
  UserToken,
} from "./solid-auth.js";
import { AnyFetchResponseType, AnyFetchType } from "../utils/generic-fetch.js";
import { CliArgsCommon } from "../common/cli-args.js";
import { DurationCounter } from "../utils/duration-counter.js";
import { promises as fs } from "fs";
import * as jose from "jose";
import { fromNow } from "../utils/time-helpers.js";
import {
  CreateAccountMethod,
  MachineLoginMethod,
  PodAndOwnerInfo,
} from "../common/interfaces.js";
import {
  discoverCreateAccountTypeAndUri,
  discoverMachineLoginTypeAndUri,
  getServerBaseUrl,
} from "../utils/solid-server-detect.js";
import { joinUri } from "../utils/uri_helper.js";
import { fetchWithLog } from "../utils/verbosity.js";

export interface AuthFetchCacheStats {
  authenticateCache: "none" | "token" | "all";
  authenticate: boolean;
  lenCssTokensByUser: number;
  lenAuthAccessTokenByUser: number;
  lenAuthFetchersByUser: number;
  useCount: number;
  tokenFetchCount: number;
  authFetchCount: number;
}

interface CacheAuthAccessToken {
  token: string;
  expire: number;
  dpopKeyPair: {
    publicKey: jose.JWK;
    privateKeyType: string;
    privateKey: string;
  };
}

export interface DumpType {
  timestamp: string;
  cssTokensByUser: Record<string, UserToken | null>;
  authAccessTokenByUser: Record<string, CacheAuthAccessToken | null>;
  filename?: string;
}

export class AuthFetchCache {
  cli: CliArgsCommon;
  authenticateCache: "none" | "token" | "all" = "none";
  authenticate: boolean = false;

  accountInfos: Record<string, PodAndOwnerInfo> = {};
  cssTokensByUser: Record<string, UserToken | null> = {};
  authAccessTokenByUser: Record<string, AccessToken | null> = {};
  authFetchersByUser: Record<string, AnyFetchType | null> = {};
  loadedAuthCacheMeta: Object = {};

  useCount: number = 0;
  tokenFetchCount: number = 0;
  authFetchCount: number = 0;

  tokenFetchDuration = new DurationCounter();
  authAccessTokenDuration = new DurationCounter();
  authFetchDuration = new DurationCounter();
  generateDpopKeyPairDurationCounter = new DurationCounter();

  fetcher: AnyFetchType;

  accountCount: number = 0;

  constructor(
    cli: CliArgsCommon,
    accountInfos: Array<PodAndOwnerInfo>,
    authenticate: boolean,
    authenticateCache: "none" | "token" | "all"
  ) {
    this.cli = cli;
    this.accountInfos = Object.fromEntries(
      accountInfos.map((p) => [this.toKey(p), p])
    );
    this.accountCount = Object.keys(this.accountInfos).length;
    this.authenticate = authenticate;
    this.authenticateCache = authenticateCache;
    this.fetcher = fetch;

    //We require unique accountInfos
    let check = new Set();
    for (const accountInfo of accountInfos) {
      const k = this.toKey(accountInfo);
      if (check.has(k)) {
        throw new Error(`Duplicate pod: ${JSON.stringify(accountInfo)}`);
      }
      check.add(k);
    }
  }

  toKey(pod: PodAndOwnerInfo): string {
    return `${pod.webID}-${pod.oidcIssuer}-${pod.podUri}`;
  }

  async discoverMachineLoginMethods(): Promise<void> {
    this.cli.v3(
      `Starting discoverMachineLoginMethods() for ${this.accountInfos.length} accounts...`
    );

    const machineLoginInfoByServer: {
      [url: string]: [MachineLoginMethod, string];
    } = {};

    //We only require unique indexes, but we check more stringent. This may be relaxed if needed.
    for (const [k, accountInfo] of Object.entries(this.accountInfos)) {
      if (!accountInfo.machineLoginMethod || !accountInfo.machineLoginUri) {
        const serverBaseUrl = getServerBaseUrl(
          accountInfo.machineLoginUri || accountInfo.oidcIssuer
        );
        if (!machineLoginInfoByServer[serverBaseUrl]) {
          machineLoginInfoByServer[serverBaseUrl] =
            await discoverMachineLoginTypeAndUri(
              this.cli,
              serverBaseUrl,
              accountInfo.machineLoginMethod,
              accountInfo.machineLoginUri
            );

          this.cli.v2(
            `discovered machine login method for ${serverBaseUrl}: ` +
              `${machineLoginInfoByServer[serverBaseUrl][0]} ${machineLoginInfoByServer[serverBaseUrl][1]}`
          );
        }

        [accountInfo.machineLoginMethod, accountInfo.machineLoginUri] =
          machineLoginInfoByServer[serverBaseUrl];
      }
    }

    this.cli.v3(
      `discoverMachineLoginMethods() found methods for ${
        Object.keys(machineLoginInfoByServer).length
      } servers.`
    );
  }

  expireAccessToken(pod: PodAndOwnerInfo) {
    const key = this.toKey(pod);
    //remove access token if it is about to expire
    const at = this.authAccessTokenByUser[key];
    if (at && !stillUsableAccessToken(at, 60)) {
      this.authAccessTokenByUser[key] = null;
      this.authFetchersByUser[key] = null;
    }
  }

  async getPodAuth(pod: PodAndOwnerInfo): Promise<PodAuth> {
    const key = this.toKey(pod);

    this.useCount++;
    if (!this.authenticate) {
      return {
        fetch: this.fetcher,
        accessToken: undefined,
        userToken: undefined,
      };
    }
    this.expireAccessToken(pod);
    let userToken = null;
    let accessToken = null;
    let theFetch = null;
    if (this.authenticateCache !== "none") {
      if (this.cssTokensByUser[key]) {
        userToken = this.cssTokensByUser[key];
      }
      if (this.authenticateCache === "all") {
        if (this.authAccessTokenByUser[key]) {
          accessToken = this.authAccessTokenByUser[key];
        }
        if (this.authFetchersByUser[key]) {
          theFetch = this.authFetchersByUser[key];
        }
      }
    }

    if (!userToken) {
      userToken = await createUserToken(
        this.cli,
        pod,
        this.fetcher,
        this.tokenFetchDuration
      );
      this.tokenFetchCount++;
    }
    if (!theFetch || !accessToken) {
      [theFetch, accessToken] = await getUserAuthFetch(
        this.cli,
        pod,
        userToken,
        this.fetcher,
        this.authAccessTokenDuration,
        this.authFetchDuration,
        this.generateDpopKeyPairDurationCounter,
        accessToken
      );
      this.authFetchCount++;
    }

    if (this.authenticateCache !== "none" && !this.cssTokensByUser[key]) {
      this.cssTokensByUser[key] = userToken;
    }
    if (this.authenticateCache === "all" && !this.authAccessTokenByUser[key]) {
      this.authAccessTokenByUser[key] = accessToken;
    }
    if (this.authenticateCache === "all" && !this.authFetchersByUser[key]) {
      this.authFetchersByUser[key] = theFetch;
    }

    return {
      fetch: theFetch,
      accessToken,
      userToken,
    };
  }

  async getAuthFetcher(pod: PodAndOwnerInfo): Promise<AnyFetchType> {
    if (!this.authenticate) {
      return this.fetcher;
    }
    const res = await this.getPodAuth(pod);
    return res.fetch;
  }

  async getAccessToken(pod: PodAndOwnerInfo): Promise<AccessToken> {
    if (!this.authenticate) {
      throw new Error(`Cannot get AccessToken when authentication disabled`);
    }
    const res = await this.getPodAuth(pod);
    if (res.accessToken == null) {
      throw new Error(`Could not get fetcher and/or AccessToken`);
    }
    return res.accessToken;
  }

  //FROM FLOOD

  async preCache(userCount: number, ensureAuthExpirationS: number) {
    if (this.authenticateCache === "none") {
      return;
    }

    let countUTFetch = 0;
    let countUTUseExisting = 0;
    let countATFetch = 0;
    let countATUseExisting = 0;
    let earliestATexpiration: Date | null = null;
    let earliestATUserIndex: number | null = null;
    let earliestATWasReused: boolean | null = null;
    let earliestATStillUsable: boolean | null = null;
    let earliestATPreviousAT: AccessToken | null = null;
    let earliestATCurAT: AccessToken | null = null;

    console.log(
      `Caching ${userCount} user logins (cache method="${this.authenticateCache}")...`
    );

    const keys = Object.keys(this.accountInfos);
    for (let userIndex = 0; userIndex < userCount; userIndex++) {
      const key = keys[userIndex];
      this.authFetchersByUser[key] = null;

      const pod = this.accountInfos[key];

      process.stdout.write(
        `   Pre-cache is authenticating user ${
          userIndex + 1
        }/${userCount}...                                        \r`
      );
      let token = this.cssTokensByUser[key];
      if (!token) {
        process.stdout.write(
          `   Pre-cache is authenticating user ${
            userIndex + 1
          }/${userCount}... fetching user token...\r`
        );
        token = await createUserToken(
          this.cli,
          pod,
          this.fetcher,
          this.tokenFetchDuration
        );
        this.cssTokensByUser[key] = token;
        this.tokenFetchCount++;
        countUTFetch++;
      } else {
        countUTUseExisting++;
      }

      if (this.authenticateCache === "all") {
        const now = new Date();
        const curAccessToken = this.authAccessTokenByUser[key];
        const atInfo = curAccessToken?.expire
          ? `(expires ${fromNow(curAccessToken?.expire)})`
          : `(none)`;
        process.stdout.write(
          `   Pre-cache is authenticating user ${
            userIndex + 1
          }/${userCount}... checking access token ${atInfo}...\r`
        );
        const [fetch, accessToken] = await getUserAuthFetch(
          this.cli,
          pod,
          token,
          this.fetcher,
          this.authAccessTokenDuration,
          this.authFetchDuration,
          this.generateDpopKeyPairDurationCounter,
          this.authAccessTokenByUser[key],
          ensureAuthExpirationS
        );
        const wasReused = this.authAccessTokenByUser[key] == accessToken;
        if (!wasReused) {
          countATFetch++;
        } else {
          countATUseExisting++;
        }
        if (
          earliestATexpiration == null ||
          accessToken.expire.getTime() < earliestATexpiration.getTime()
        ) {
          earliestATexpiration = accessToken.expire;
          earliestATUserIndex = userIndex;
          earliestATWasReused = wasReused;
          earliestATStillUsable = stillUsableAccessToken(
            accessToken,
            ensureAuthExpirationS
          );
          earliestATCurAT = accessToken;
          earliestATPreviousAT = this.authAccessTokenByUser[key];
        }
        this.authAccessTokenByUser[key] = accessToken;
        this.authFetchersByUser[key] = fetch;
        this.authFetchCount++;
      }
    }
    process.stdout.write(`\n`);
    console.log(`Precache done. Counts:`);
    console.log(
      `     UserToken fetch ${countUTFetch} reuse ${countUTUseExisting}`
    );
    console.log(
      `     AccessToken fetch ${countATFetch} reuse ${countATUseExisting}`
    );
    console.log(
      `     First AccessToken expiration: ${earliestATexpiration?.toISOString()}=${fromNow(
        earliestATexpiration
      )}` +
        ` (user ${earliestATUserIndex} reused=${earliestATWasReused} stillUsable=${earliestATStillUsable} ` +
        `ensureAuthExpirationS=${ensureAuthExpirationS} ` +
        `prevExpire=${earliestATPreviousAT?.expire.toISOString()}=${fromNow(
          earliestATPreviousAT?.expire
        )})`
    );

    console.assert(earliestATStillUsable);
  }

  validate(userCount: number, ensureAuthExpirationS: number) {
    if (this.authenticateCache === "none") {
      return;
    }

    console.log(
      `Validating cache of ${userCount} user logins (cache method="${this.authenticateCache}")...`
    );

    const now = new Date();
    let allValid = true;
    const keys = Object.keys(this.accountInfos);
    for (let userIndex = 0; userIndex < userCount; userIndex++) {
      const key = keys[userIndex];
      process.stdout.write(
        `   Validating user ${userIndex + 1}/${userCount}...\r`
      );
      this.authFetchersByUser[key] = null;
      const account = this.accountInfos[key].username;

      const token = this.cssTokensByUser[key];
      if (!token) {
        console.warn(`   No user token for ${account}`);
        allValid = false;
      }

      const accessToken = this.authAccessTokenByUser[key];
      if (this.authenticateCache === "all" && !accessToken) {
        console.warn(`   No access token for ${account}`);
        allValid = false;
      }

      if (
        this.authenticateCache === "all" &&
        accessToken &&
        !stillUsableAccessToken(accessToken, ensureAuthExpirationS)
      ) {
        const secondUntilExpiration =
          (accessToken.expire.getTime() - now.getTime()) / 1000.0;
        console.warn(
          `   No usable access token for ${account}. \n` +
            `      expiration=${accessToken.expire} \n` +
            `             now=${now} \n` +
            `      secondUntilExpiration=${secondUntilExpiration}`
        );
        allValid = false;
      }
    }
    process.stdout.write(`\n`);
    if (!allValid) {
      console.error("Cache validation failed. Exiting.");
      process.exit(1);
    } else {
      console.log(`    ... all valid!`);
    }
  }

  async test(accountCount: number, filename: string, fetchTimeoutMs: number) {
    console.log(
      `Testing ${accountCount} solid logins (authenticate=${this.authenticate} authenticateCache="${this.authenticateCache}")...`
    );
    const keys = Object.keys(this.accountInfos);
    console.assert(accountCount < keys.length);

    let allSuccess = true;
    for (let accountIndex = 0; accountIndex < accountCount; accountIndex++) {
      const key = keys[accountIndex];
      const accountInfo = this.accountInfos[key];
      process.stdout.write(
        `   Testing account ${accountIndex + 1}/${accountCount} (${
          accountInfo.username
        })...\r`
      );
      const testUrl = joinUri(accountInfo.podUri, filename);
      try {
        const podAuth = await this.getPodAuth(accountInfo);
        const res: AnyFetchResponseType = await fetchWithLog(
          podAuth.fetch,
          "Testing Auth",
          this.cli,
          testUrl,
          {
            method: "GET",
            //open bug in nodejs typescript that AbortSignal.timeout doesn't work
            //  see https://github.com/node-fetch/node-fetch/issues/741
            // @ts-ignore
            signal: AbortSignal.timeout(fetchTimeoutMs), // abort after 4 seconds //supported in nodejs>=17.3
          },
          true,
          async () => {
            return podAuth.accessToken
              ? await getFetchAuthHeadersFromAccessToken(
                  this.cli,
                  accountInfo,
                  "get",
                  testUrl,
                  podAuth.accessToken
                )
              : {};
          }
        );
        if (!res.ok) {
          allSuccess = false;
          console.error(
            `         Authentication test failed for user ${accountInfo.username} (GET ${testUrl}). HTTP status ${res.status}`
          );
          console.error(`            Error message: ${await res.text()}`);
        } else {
          const body = await res.text();
          if (!body) {
            console.error(
              `         Authentication test failed for user ${accountInfo.username} (GET ${testUrl}): no body`
            );
            allSuccess = false;
          }
        }
      } catch (e) {
        allSuccess = false;
        console.error(
          `         Authentication test exception for user ${accountInfo.username} (GET ${testUrl})`,
          e
        );
      }
    }
    process.stdout.write(`\n`);
    if (!allSuccess) {
      console.error("Authentication test failed. Exiting.");
      process.exit(1);
    } else {
      console.log(`    ... authentication test success!`);
    }
  }

  // cssBaseUrl: string;
  // authenticateCache: "none" | "token" | "all" = "none";
  // authenticate: boolean = false;
  //
  // cssTokensByUser: Array<UserToken | null> = [];
  // authFetchersByUser: Array<typeof fetch | null> = [];
  toString(): string {
    return `AuthFetchCache{
                authenticateCache=${this.authenticateCache}, 
                authenticate=${this.authenticate}, 
                cssTokensByUser.length=${this.cssTokensByUser.length}, 
                authAccessTokenByUser.length=${this.authAccessTokenByUser.length}, 
                authFetchersByUser.length=${this.authFetchersByUser.length}, 
                useCount=${this.useCount}, 
                tokenFetchCount=${this.tokenFetchCount}, 
                authFetchCount=${this.authFetchCount}
            }`;
  }

  toStatsObj(): AuthFetchCacheStats {
    return {
      authenticateCache: this.authenticateCache,
      authenticate: this.authenticate,
      lenCssTokensByUser: Object.keys(this.cssTokensByUser).length,
      lenAuthAccessTokenByUser: Object.keys(this.authAccessTokenByUser).length,
      lenAuthFetchersByUser: Object.keys(this.authFetchersByUser).length,
      useCount: this.useCount,
      tokenFetchCount: this.tokenFetchCount,
      authFetchCount: this.authFetchCount,
    };
  }

  toCountString(): string {
    return `${this.cssTokensByUser.length} userTokens and ${this.authAccessTokenByUser.length} authAccessTokens`;
  }

  async dump(): Promise<DumpType> {
    const accessTokenForJson: Record<string, CacheAuthAccessToken | null> =
      Object.fromEntries(
        await Promise.all(
          Object.entries(this.authAccessTokenByUser).map(
            async ([user, accessToken]) => [
              user,
              !accessToken
                ? null
                : {
                    token: accessToken.token,
                    expire: accessToken.expire.getTime(),
                    dpopKeyPair: {
                      publicKey: accessToken.dpopKeyPair.publicKey, //already a JWK
                      privateKeyType: accessToken.dpopKeyPair.privateKey.type,
                      // @ts-ignore
                      privateKey: await jose.exportPKCS8(
                        // @ts-ignore
                        accessToken.dpopKeyPair.privateKey
                      ),
                    },
                  },
            ]
          )
        )
      );
    return {
      timestamp: new Date().toISOString(),
      cssTokensByUser: { ...this.cssTokensByUser },
      authAccessTokenByUser: accessTokenForJson,
    };
  }
  async save(authCacheFile: string) {
    const cacheContent = await this.dump();
    cacheContent.filename = authCacheFile;
    await fs.writeFile(authCacheFile, JSON.stringify(cacheContent));
  }
  async saveHeadersAsCsv(
    pod: PodAndOwnerInfo,
    podFilename: string,
    csvFile: string
  ) {
    const keys = Object.keys(this.accountInfos);
    const csvLines: string[] = [];
    for (let userIndex = 0; userIndex < keys.length; userIndex++) {
      const key = keys[userIndex];
      const resourceUrl = joinUri(pod.podUri, podFilename);

      const [authHeaders, accessToken] = await getFetchAuthHeaders(
        this.cli,
        pod,
        "get",
        pod.podUri,
        this.cssTokensByUser[key]!,
        fetch,
        null,
        null,
        null,
        this.authAccessTokenByUser[key],
        3600
      );
      csvLines.push(
        `${userIndex},${resourceUrl},${authHeaders["Authorization"]},${authHeaders["DPoP"]}`
      );
    }
    await fs.writeFile(csvFile, csvLines.join("\n"));
  }

  async load(authCacheFile: string) {
    const cacheContent = await fs.readFile(authCacheFile, "utf-8");
    await this.loadString(cacheContent);
  }

  async loadString(cacheContent: string) {
    const c = JSON.parse(cacheContent);
    if (
      !c.cssTokensByUser ||
      !c.authAccessTokenByUser ||
      !c.timestamp ||
      !Object.keys(c.cssTokensByUser).every((k) => typeof k === "string") ||
      !Object.values(c.cssTokensByUser).every((k) => typeof k === "object") ||
      !Object.keys(c.authAccessTokenByUser).every(
        (k) => typeof k === "string"
      ) ||
      !Object.values(c.authAccessTokenByUser).every(
        (k) => typeof k === "object"
      )
    ) {
      throw new Error(
        `Invalid content loaded for AuthFetchCache: ${cacheContent}`
      );
    }
    this.cssTokensByUser = c.cssTokensByUser;
    this.authAccessTokenByUser = c.authAccessTokenByUser;
    this.loadedAuthCacheMeta = {
      timestamp: c.timestamp,
      filename: c.filename,
    };
    for (const accessToken of Object.values(this.authAccessTokenByUser)) {
      if (accessToken) {
        //because we got if from JSON, accessToken.dpopKeyPair.privateKey will be PKCS8, not a KeyLike!
        accessToken.dpopKeyPair.privateKey = await jose.importPKCS8(
          // @ts-ignore
          accessToken.dpopKeyPair.privateKey,
          // @ts-ignore
          accessToken.dpopKeyPair.privateKeyType
        );

        //because we got if from JSON, accessToken.expire will be a string, not a Date!
        // @ts-ignore
        if (typeof accessToken.expire !== "number") {
          throw new Error(
            `AccessToken in JSON has expire of unexpected type` +
              ` (${typeof accessToken.expire} instead of number) value=${
                accessToken.expire
              }`
          );
        }
        const expireLong: number = <number>accessToken.expire;
        accessToken.expire = new Date(expireLong);
      }
    }
  }
}
