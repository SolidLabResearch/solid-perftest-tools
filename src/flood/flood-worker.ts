#!/usr/bin/env node

import { ControllerMsg, WorkerMsg } from "./flood-messages.js";
import { CliArgsFlood, getCliArgs } from "./flood-args.js";
import { AuthFetchCache } from "../solid/auth-fetch-cache.js";
import {
  Counter,
  makeStatistics,
  runNamedStep,
  stepFlood,
} from "./flood-steps.js";
import { MessageCheat } from "./message-cheat.js";
import { FloodState } from "./flood-state.js";

async function main() {
  if (!process.send) {
    console.error(
      "Don't call this directly! solid-flood-worker should be spawned as child process of solid-flood."
    );
    process.exit(1);
  }

  process.send({
    messageType: "WorkerAnnounce",
    pid: process.pid,
  });

  //help us handle messages in async way
  const msgCheat = new MessageCheat<ControllerMsg>();
  process.on("message", (message: ControllerMsg) =>
    msgCheat.messageCallback(message)
  );

  //handle messages
  let stopped = false;
  let processIndex: number | undefined = undefined;
  let cli: CliArgsFlood | null = null;
  // let fetcher: AnyFetchType | null = null;
  let floodState: FloodState | null = null;
  let counter = new Counter();
  const allFetchStartEnd: { start: number | null; end: number | null } = {
    start: null,
    end: null,
  };

  while (!stopped) {
    const { message } = await msgCheat.waitForMessage();
    console.log(
      `Worker ${process.pid} got message of type '${message.messageType}'`
    );
    switch (message.messageType) {
      case "SetCliArgs": {
        const v = message.cliArgs.verbosity_count;
        cli = {
          ...message.cliArgs,
          v3: (message?: any, ...optionalParams: any[]) => {
            if (v >= 3) console.log(message, ...optionalParams);
          },
          v2: (message?: any, ...optionalParams: any[]) => {
            if (v >= 2) console.log(message, ...optionalParams);
          },
          v1: (message?: any, ...optionalParams: any[]) => {
            if (v >= 1) console.log(message, ...optionalParams);
          },
        };
        //override fetchCount with the part of the fetchCount for this process
        console.log(
          `Overriding for process ${process.pid}: ` +
            `fetchCount=${message.processFetchCount} instead of ${cli.fetchCount}`
        );
        console.log(
          `Overriding for process ${process.pid}: ` +
            `  parallel=${message.parallelFetchCount} instead of ${cli.parallel}`
        );
        cli.fetchCount = message.processFetchCount;
        cli.parallel = message.parallelFetchCount;
        if (typeof message.index === "number") {
          console.log(
            `Overriding for process ${process.pid}: ` +
              `  filenameIndexingStart=${message.index} instead of ${cli.filenameIndexingStart}`
          );
          cli.filenameIndexingStart = message.index;
        }
        processIndex = message.processIndex;
        break;
      }
      case "SetFloodState": {
        if (cli == null /*|| fetcher == null*/) {
          throw new Error(`SetFloodState called before SetCliArgs`);
        }
        const pods = message.pods;
        const authFetchCache = new AuthFetchCache(
          cli,
          pods,
          cli.authenticate,
          cli.authenticateCache
        );
        await authFetchCache.discoverMachineLoginMethods();
        console.assert(
          authFetchCache.authAccessTokenByUser !== null,
          "authFetchCache.authAccessTokenByUser !== null"
        );
        await authFetchCache.loadString(message.authCacheContent);
        // await authFetchCache.validate(cli.userCount, cli.ensureAuthExpirationS);
        floodState = {
          pods,
          authFetchCache,
        };
        break;
      }
      case "RunStep": {
        try {
          if (
            cli == null ||
            // fetcher == null ||
            floodState == null ||
            floodState.authFetchCache == null
          ) {
            throw new Error(
              `RunStep called before SetCliArgs and/or SetFloodState`
            );
          }
          console.assert(
            floodState.authFetchCache.authAccessTokenByUser !== null,
            "floodState.authFetchCache.authAccessTokenByUser !== null"
          );
          if (message.stepName != "flood") {
            await runNamedStep(
              floodState,
              message.stepName,
              cli,
              counter,
              allFetchStartEnd
            );
          } else {
            // await authFetchCache.validate(
            //   cli.userCount,
            //   cli.ensureAuthExpirationS
            // );
            if (typeof processIndex !== "number") {
              throw new Error(
                `processIndex not set correctly: ${processIndex}`
              );
            }
            try {
              await stepFlood(
                floodState,
                cli,
                counter,
                allFetchStartEnd,
                processIndex
              );
            } finally {
              const floodStatistics = makeStatistics(
                counter,
                allFetchStartEnd,
                floodState.authFetchCache
              );
              // @ts-ignore this should not happen, we checked this at start
              process.send({
                messageType: "ReportFloodStatistics",
                statistics: floodStatistics,
              });
            }
          }
        } finally {
          // @ts-ignore this should not happen, we checked this at start
          process.send({
            messageType: "ReportStepDone",
          });
        }
        break;
      }
      case "StopWorker": {
        stopped = true;
        break;
      }
      default: {
        // @ts-ignore
        throw new Error(`Unknown msg ${message.messageType}`);
      }
    }
  }

  console.log(`Worker ${process.pid} is exiting.`);
}

try {
  await main();
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
