import {
  AccessToken,
  createUserToken,
  getFetchAuthHeaders,
  getUserAuthFetch,
  stillUsableAccessToken,
  UserToken,
} from "./solid-auth.js";
import { AnyFetchResponseType, AnyFetchType } from "../utils/generic-fetch.js";
import { CliArgsCommon } from "../common/cli-args.js";
import { DurationCounter } from "../utils/duration-counter.js";
import { promises as fs } from "fs";
import * as jose from "jose";
import { fromNow } from "../utils/time-helpers.js";
import nodeFetch from "node-fetch";
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

interface DumpType {
  timestamp: string;
  cssTokensByUser: Array<UserToken | null>;
  authAccessTokenByUser: Array<CacheAuthAccessToken | null>;
  filename?: string;
}

export class AuthFetchCache {
  cli: CliArgsCommon;
  authenticateCache: "none" | "token" | "all" = "none";
  authenticate: boolean = false;

  accountInfos: Array<PodAndOwnerInfo> = [];
  cssTokensByUser: Array<UserToken | null> = [];
  authAccessTokenByUser: Array<AccessToken | null> = [];
  authFetchersByUser: Array<AnyFetchType | null> = [];
  loadedAuthCacheMeta: Object = {};

  useCount: number = 0;
  tokenFetchCount: number = 0;
  authFetchCount: number = 0;

  tokenFetchDuration = new DurationCounter();
  authAccessTokenDuration = new DurationCounter();
  authFetchDuration = new DurationCounter();
  generateDpopKeyPairDurationCounter = new DurationCounter();

  fetcher: AnyFetchType;

  constructor(
    cli: CliArgsCommon,
    accountInfos: Array<PodAndOwnerInfo>,
    authenticate: boolean,
    authenticateCache: "none" | "token" | "all"
  ) {
    this.cli = cli;
    this.accountInfos = accountInfos;
    this.authenticate = authenticate;
    this.authenticateCache = authenticateCache;
    this.fetcher = nodeFetch; //cli.fetcher TODO ? nodeFetch : es6fetch;;

    //We only require unique indexes, but we check more stringent. This may be relaxed if needed.
    let i = 0;
    for (const accountInfo of accountInfos) {
      if (accountInfo.index != i) {
        throw new Error(
          `Unexpected accountInfo index ${accountInfo.index} at index ${i}`
        );
      }
      i++;
    }
  }

  async discoverMachineLoginMethods(): Promise<void> {
    const machineLoginInfoByServer: {
      [url: string]: [MachineLoginMethod, string];
    } = {};

    //We only require unique indexes, but we check more stringent. This may be relaxed if needed.
    for (const accountInfo of this.accountInfos) {
      if (!accountInfo.machineLoginMethod) {
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

          this.cli.v3(
            `discovered machine login method for ${serverBaseUrl}: ` +
              `${machineLoginInfoByServer[serverBaseUrl][0]} ${machineLoginInfoByServer[serverBaseUrl][1]}`
          );
        }

        [accountInfo.machineLoginMethod, accountInfo.machineLoginUri] =
          machineLoginInfoByServer[serverBaseUrl];
      }
    }
  }

  expireAccessToken(userId: number) {
    //remove access token if it is about to expire
    const at = this.authAccessTokenByUser[userId];
    if (at && !stillUsableAccessToken(at, 60)) {
      this.authAccessTokenByUser[userId] = null;
      this.authFetchersByUser[userId] = null;
    }
  }

  async getAuthFetcher(pod: PodAndOwnerInfo): Promise<AnyFetchType> {
    console.assert(pod.index < this.accountInfos.length);
    this.useCount++;
    if (!this.authenticate) {
      return this.fetcher;
    }
    this.expireAccessToken(pod.index);
    let userToken = null;
    let accessToken = null;
    let theFetch = null;
    if (this.authenticateCache !== "none") {
      if (this.cssTokensByUser[pod.index]) {
        userToken = this.cssTokensByUser[pod.index];
      }
      if (this.authenticateCache === "all") {
        if (this.authAccessTokenByUser[pod.index]) {
          accessToken = this.authAccessTokenByUser[pod.index];
        }
        if (this.authFetchersByUser[pod.index]) {
          theFetch = this.authFetchersByUser[pod.index];
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
    if (!theFetch) {
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

    if (this.authenticateCache !== "none" && !this.cssTokensByUser[pod.index]) {
      this.cssTokensByUser[pod.index] = userToken;
    }
    if (
      this.authenticateCache === "all" &&
      !this.authAccessTokenByUser[pod.index]
    ) {
      this.authAccessTokenByUser[pod.index] = accessToken;
    }
    if (
      this.authenticateCache === "all" &&
      !this.authFetchersByUser[pod.index]
    ) {
      this.authFetchersByUser[pod.index] = theFetch;
    }

    return theFetch;
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

    for (let userIndex = 0; userIndex < userCount; userIndex++) {
      this.authFetchersByUser[userIndex] = null;

      const pod = this.accountInfos[userIndex];

      process.stdout.write(
        `   Pre-cache is authenticating user ${
          userIndex + 1
        }/${userCount}...                                        \r`
      );
      let token = this.cssTokensByUser[userIndex];
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
        this.cssTokensByUser[userIndex] = token;
        this.tokenFetchCount++;
        countUTFetch++;
      } else {
        countUTUseExisting++;
      }

      if (this.authenticateCache === "all") {
        const now = new Date();
        const curAccessToken = this.authAccessTokenByUser[userIndex];
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
          this.authAccessTokenByUser[userIndex],
          ensureAuthExpirationS
        );
        const wasReused = this.authAccessTokenByUser[userIndex] == accessToken;
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
          earliestATPreviousAT = this.authAccessTokenByUser[userIndex];
        }
        this.authAccessTokenByUser[userIndex] = accessToken;
        this.authFetchersByUser[userIndex] = fetch;
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
    for (let userIndex = 0; userIndex < userCount; userIndex++) {
      process.stdout.write(
        `   Validating user ${userIndex + 1}/${userCount}...\r`
      );
      this.authFetchersByUser[userIndex] = null;
      const account = `user${userIndex}`;

      const token = this.cssTokensByUser[userIndex];
      if (!token) {
        console.warn(`   No user token for ${account}`);
        allValid = false;
      }

      const accessToken = this.authAccessTokenByUser[userIndex];
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
    console.assert(accountCount < this.accountInfos.length);

    let allSuccess = true;
    for (let accountIndex = 0; accountIndex < accountCount; accountIndex++) {
      const accountInfo = this.accountInfos[accountIndex];
      process.stdout.write(
        `   Testing account ${accountIndex + 1}/${accountCount} (${
          accountInfo.username
        })...\r`
      );
      try {
        const aFetch = await this.getAuthFetcher(accountInfo);
        const res: AnyFetchResponseType = await aFetch(
          `${accountInfo.podUri}/${filename}`,
          {
            method: "GET",
            //open bug in nodejs typescript that AbortSignal.timeout doesn't work
            //  see https://github.com/node-fetch/node-fetch/issues/741
            // @ts-ignore
            signal: AbortSignal.timeout(fetchTimeoutMs), // abort after 4 seconds //supported in nodejs>=17.3
          }
        );
        if (!res.ok) {
          allSuccess = false;
          console.error(
            `         Authentication test failed for user ${accountInfo.username}. HTTP status ${res.status}`
          );
          console.error(`            Error message: ${await res.text()}`);
        } else {
          const body = await res.text();
          if (!body) {
            console.error(
              `         Authentication test failed for user ${accountInfo.username}: no body`
            );
            allSuccess = false;
          }
        }
      } catch (e) {
        allSuccess = false;
        console.error(
          `         Authentication test exception for user ${accountInfo.username}`,
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
      lenCssTokensByUser: this.cssTokensByUser.length,
      lenAuthAccessTokenByUser: this.authAccessTokenByUser.length,
      lenAuthFetchersByUser: this.authFetchersByUser.length,
      useCount: this.useCount,
      tokenFetchCount: this.tokenFetchCount,
      authFetchCount: this.authFetchCount,
    };
  }

  toCountString(): string {
    return `${this.cssTokensByUser.length} userTokens and ${this.authAccessTokenByUser.length} authAccessTokens`;
  }

  async dump(): Promise<DumpType> {
    const accessTokenForJson: (CacheAuthAccessToken | null)[] =
      await Promise.all(
        [...this.authAccessTokenByUser].map(async (accessToken) =>
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
              }
        )
      );
    return {
      timestamp: new Date().toISOString(),
      cssTokensByUser: this.cssTokensByUser,
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
    const csvLines: string[] = [];
    for (
      let userIndex = 0;
      userIndex < this.cssTokensByUser.length;
      userIndex++
    ) {
      const account = `user${userIndex}`;
      const resourceUrl = `${pod.podUri}/${podFilename}`;

      const [authHeaders, accessToken] = await getFetchAuthHeaders(
        this.cli,
        pod,
        "get",
        this.cssTokensByUser[userIndex]!,
        fetch,
        null,
        null,
        null,
        this.authAccessTokenByUser[userIndex],
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
      !Array.isArray(c.cssTokensByUser) ||
      !Array.isArray(c.authAccessTokenByUser)
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
    for (const accessToken of this.authAccessTokenByUser.values()) {
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
