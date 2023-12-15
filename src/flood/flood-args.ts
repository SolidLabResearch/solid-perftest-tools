#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  CliArgsCommon,
  getArgvCommon,
  processYargsCommon,
} from "../common/cli-args.js";

export type StepName =
  | "loadAC"
  | "fillAC"
  | "validateAC"
  | "testRequest"
  | "testRequests"
  | "saveAC"
  | "notificationsSubscribe"
  | "notificationsConnectWebsockets"
  // | "notificationsServeWebHooks"  //won't implement: YAGNI
  | "notificationsDelete"
  | "saveAuthHeaders"
  | "flood";

const ALLOWED_STEPS: StepName[] = [
  "loadAC",
  "fillAC",
  "validateAC",
  "testRequest",
  "testRequests",
  "saveAC",
  "notificationsSubscribe",
  "notificationsConnectWebsockets",
  // "notificationsServeWebHooks",
  "notificationsDelete",
  "flood",
];

let ya = getArgvCommon()
  .usage("Usage: $0 [--steps <steps>] ...")
  //general options
  .option("steps", {
    group: "Base:",
    type: "string",
    description: `The steps that need to run, as a comma separated list. See below for more details.`,
    default: "flood",
  })
  .option("reportFile", {
    group: "Base:",
    type: "string",
    description:
      "File to save report to (JSON format). Of not specified, the report is sent to stdout like the other output.",
  })
  //flood config
  .option("duration", {
    group: "Fetcher Setup:",
    // alias: "fc",
    type: "number",
    description:
      "Total duration (in seconds) of the flood. After this time, no new fetches are done. " +
      "If this option is used, --fetchCount is ignored." +
      "Default: run until all requested fetches are done.",
    demandOption: false,
  })
  .option("fetchCount", {
    group: "Fetcher Setup:",
    // alias: "fc",
    type: "number",
    description: "Number of fetches per user during the flood.",
    demandOption: false,
    default: 10,
  })
  .option("parallel", {
    group: "Fetcher Setup:",
    // alias: "pc",
    type: "number",
    description: "Number of fetches in parallel during the flood.",
    demandOption: false,
    default: 10,
  })
  .option("processCount", {
    group: "Fetcher Setup:",
    // alias: "uc",
    type: "number",
    description:
      "Number of client processes to run in parallel. (Fetches and parallel fetches are distributed evenly between these processes.)",
    demandOption: false,
    default: 1,
  })
  .option("podCount", {
    group: "Fetcher Setup:",
    // alias: "uc",
    type: "number",
    description:
      "Number of pods to use when fetching (default 0 which means all available). " +
      "There can be more pods available (see --account-* options), but only this many will be used.",
    demandOption: false,
    default: 0,
  })
  .option("fetchTimeoutMs", {
    group: "Fetch Action:",
    // alias: "t",
    type: "number",
    description:
      "How long before aborting a fetch because it takes too long? (in ms)",
    demandOption: false,
    default: 4_000,
  })
  .option("filename", {
    group: "Fetch Action:",
    // alias: "f",
    type: "string",
    description:
      "Remote file to download from pod, or filename of file to upload to pod",
    default: "10.rnd",
  })
  .option("filenameIndexing", {
    group: "Fetch Action:",
    type: "boolean",
    description:
      "Replace the literal string 'INDEX' in the filename for each action (upload/download). " +
      "This way, each fetch uses a unique filename. Index will start from 0 (change with --filenameIndexingStart) and increment.",
    default: false,
  })
  .option("filenameIndexingStart", {
    group: "Fetch Action:",
    type: "number",
    description: "Set the index that --filenameIndexing starts with",
    default: 0,
  })
  .option("uploadSizeByte", {
    group: "Fetch Action:",
    type: "number",
    description: "Number of bytes of (random) data to upload for POST/PUT",
    default: 10,
  })
  .option("verb", {
    group: "Fetch Action:",
    // alias: "v",
    type: "string",
    choices: ["GET", "PUT", "POST", "DELETE", "PATCH"],
    description: "HTTP verb to use for the flood: GET/PUT/POST/DELETE",
    default: "GET",
  })
  .option("scenario", {
    group: "Fetch Action:",
    type: "string",
    choices: [
      "BASIC",
      "CONTENT_TRANSLATION",
      "NO_CONTENT_TRANSLATION",
      "N3_PATCH",
      "NOTIFICATION",
    ],
    description:
      "Fetch scenario: what sort of fetch action is this? BASIC is a simple file upload/download/delete.",
    default: "BASIC",
  })
  .option("randomizePodCallOrder", {
    group: "Fetch Action:",
    type: "boolean",
    default: true,
    description: "Use all pods in random order instead of sequential?",
    demandOption: false,
  })
  //authentication
  .option("authenticate", {
    group: "Fetch Authentication:",
    // alias: "a",
    type: "boolean",
    description: "Authenticated as the user owning the target file",
    default: false,
  })
  .option("authenticateCache", {
    group: "Fetch Authentication:",
    type: "string",
    choices: ["none", "token", "all"],
    description:
      "How much authentication should be cached? All authentication (=all)? Only the CSS user token (=token)? Or no caching (=none)?",
    default: "all",
  })
  .option("authCacheFile", {
    group: "Fetch Authentication:",
    type: "string",
    description: "File to load/save the authentication cache from/to",
  })
  .option("csvFile", {
    group: "Fetch Authentication:",
    type: "string",
    description:
      "CSV File to save the authentication cache to, in the form or HTTP headers",
  })
  .option("ensureAuthExpiration", {
    group: "Fetch Authentication:",
    type: "number",
    default: 90,
    description:
      "fillAC and validateAC will ensure the authentication cache content is still valid for at least this number of seconds",
  })
  //advanced
  .option("fetchVersion", {
    group: "Advanced:",
    type: "string",
    choices: ["node", "es6"],
    description:
      "Use node-fetch or ES6 fetch (ES6 fetch is only available for nodejs versions >= 18)",
    default: "node",
  })
  .option("n3PatchGenFile", {
    group: "Advanced:",
    type: "string",
    description:
      "(For scenario N3_PATCH only:) A file with the content of the target N-triples file that will be patched. This will be used to generate a random N3 PATCH.",
    demandOption: false,
  })
  .option("notificationSubscriptionCount", {
    group: "Notifications:",
    type: "number",
    default: 0,
    description:
      "(For scenario NOTIFICATION only:) The number of notification subscriptions to make.",
    demandOption: false,
  })
  .option("notificationChannelType", {
    group: "Notifications:",
    type: "string",
    choices: ["websocket", "webhook"],
    default: "websocket",
    description:
      "(For scenario NOTIFICATION only:) The type of notification channel",
    demandOption: false,
  })
  .option("notificationWebhookTarget", {
    group: "Notifications:",
    type: "string",
    default: "http://localhost/ignore",
    description:
      "(For scenario NOTIFICATION only:) The webhook notification sendTo address.",
    demandOption: false,
  })
  .option("notificationIgnore", {
    group: "Notifications:",
    type: "boolean",
    default: true,
    description:
      "(For scenario NOTIFICATION only:) Ignore the notifications? (= do not connect to websocket or listen on hook sendTo address)",
    demandOption: false,
  })
  .epilogue(
    `Details for --steps:
    
solid-flood performs one or more steps in a fixed order. 
--steps selects which steps run (and which don't).

A lot of these steps are related to the "Authentication Cache".
Note that this cache is not used if authentication is disabled.
How much the authentication cache caches, can also be configured with the --authenticateCache option.
The file used to load/save the authentication cache is controlled by the --authCacheFile option.

The steps that can run are (always in this order):

- loadAC: Load the authentication cache from file.
- fillAC: Perform authentication of all users, which fills the authentication cache.
- validateAC: Check if all entries in the authentication cache are up to date. 
              This step causes exit with code 1 if there is at least one cache entry that has expired.
- testRequest: Do 1 request (typically a GET to download a file) for the first user. 
               This tests both the data in the authentication cache (adding missing entries), and the actual request.
- testRequests: Do 1 request (typically a GET to download a file) for each users (back-to-back, not in parallel). 
                This tests both the data in the authentication cache (adding missing entries), and the actual request.
- saveAC: Save the authentication cache to file.
- saveAuthHeaders: Save the authentication cache to file, as CSV with HTTP headers.
- notificationsSubscribe: Subscribe to the requested amount of notifications.
- notificationsConnectWebsockets: Connect and listen to all webhooks from the notificationsSubscribe step. (Then continue to the next step, and ignore all incomming data.)
- flood: Run the actual "flood": generate load on the target CSS by running a number of requests in parallel.

Examples:
--steps 'loadAC,validateAC,flood'
--steps 'fillAC,saveAC'
--steps 'loadAC,fillAC,saveAC'
--steps 'loadAC,testRequest,saveAC,flood'

All steps (makes little sense):
--steps 'loadAC,fillAC,validateAC,testRequest,testRequests,saveAC,flood'

`
  )
  .coerce("steps", (arg) => {
    const res = arg.split(",");
    for (const step of res) {
      if (!ALLOWED_STEPS.includes(step)) {
        throw new Error(`${step} is not an known step`);
      }
    }
    //Steps should always run in correct order. So sort them.
    res.sort((a: StepName, b: StepName) => {
      const aIndex = ALLOWED_STEPS.indexOf(a);
      const bIndex = ALLOWED_STEPS.indexOf(b);
      return aIndex - bIndex;
    });
    return res;
  })
  .check((argv, options) => {
    if (argv.scenario == "N3_PATCH" && argv.verb != "PATCH") {
      throw new Error("--scenario N3_PATCH implies --verb PATCH");
    }
    if (argv.scenario == "N3_PATCH" && !argv.n3PatchGenFile) {
      throw new Error("--scenario N3_PATCH requires --n3PatchGenFile");
    }
    return true;
  })
  .wrap(120)
  .strict(true);

// ya = ya.wrap(ya.terminalWidth());
const argv = ya.parseSync();

export enum HttpVerb {
  GET = "GET",
  PUT = "PUT",
  POST = "POST",
  PATCH = "PATCH",
  DELETE = "DELETE",
}

export type FetchScenario =
  | "BASIC"
  | "N3_PATCH"
  | "NOTIFICATION"
  | "CONTENT_TRANSLATION"
  | "NO_CONTENT_TRANSLATION";

export interface CliArgsFlood extends CliArgsCommon {
  podCount: number;
  fetchTimeoutMs: number;
  fetchCount: number;
  parallel: number;
  processCount: number;
  durationS: number;
  authenticateCache: "none" | "token" | "all";
  authenticate: boolean;
  useNodeFetch: boolean;
  authCacheFile?: string;
  csvFile?: string;
  reportFile?: string;
  ensureAuthExpirationS: number;
  steps: StepName[];
  podFilename: string;
  filenameIndexing: boolean;
  filenameIndexingStart: number;
  httpVerb: HttpVerb;
  mustUpload: boolean;
  uploadSizeByte: number;
  scenario: FetchScenario;
  n3PatchGenFilename?: string;
  notificationSubscriptionCount: number;
  notificationChannelType: "websocket" | "webhook";
  notificationWebhookTarget: string;
  notificationIgnore: boolean;
  randomizePodCallOrder: boolean;
}

export function getCliArgs(): CliArgsFlood {
  const httpVerb = <HttpVerb>argv.verb;
  const commonCli = processYargsCommon(argv);
  return {
    ...commonCli,
    podFilename: argv.filename,
    filenameIndexing: argv.filenameIndexing,
    filenameIndexingStart: argv.filenameIndexingStart,
    httpVerb: httpVerb,
    mustUpload: httpVerb == "POST" || httpVerb == "PUT" || httpVerb == "PATCH",
    uploadSizeByte: argv.uploadSizeByte,
    scenario: <FetchScenario>argv.scenario,

    podCount: argv.podCount || 0,
    fetchTimeoutMs: argv.fetchTimeoutMs || 4_000,
    fetchCount: argv.fetchCount || 1,
    parallel: argv.parallel || 10,
    processCount: argv.processCount || 1,
    durationS: argv.duration || 0,
    authenticateCache:
      <"none" | "token" | "all">argv.authenticateCache || "all",
    authenticate: argv.authenticate || false,
    useNodeFetch: argv.fetchVersion == "node" || false,
    authCacheFile: argv.authCacheFile || undefined,
    csvFile: argv.csvFile || undefined,
    reportFile: argv.reportFile || undefined,
    ensureAuthExpirationS: argv.ensureAuthExpiration || 90,

    //TODO ignore AC steps if !cli.authenticate
    steps: <StepName[]>argv.steps,
    n3PatchGenFilename: argv.n3PatchGenFile,

    notificationSubscriptionCount: argv.notificationSubscriptionCount,
    notificationChannelType: <"websocket" | "webhook">(
      argv.notificationChannelType
    ),
    notificationWebhookTarget: argv.notificationWebhookTarget,
    notificationIgnore: argv.notificationIgnore,
    randomizePodCallOrder: argv.randomizePodCallOrder,
  };
}
