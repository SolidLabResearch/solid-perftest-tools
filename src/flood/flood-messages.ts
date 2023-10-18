#!/usr/bin/env node

import { CliArgsFlood, StepName } from "./flood-args.js";
import { FloodStatistics } from "./flood-steps.js";
import { FloodState } from "./flood-state.js";
import { PodAndOwnerInfo } from "../common/interfaces.js";

export interface WorkerAnnounce {
  messageType: "WorkerAnnounce";
  pid: number;
}

export interface ReportStepDone {
  messageType: "ReportStepDone";
}

export interface ReportFloodStatistics {
  messageType: "ReportFloodStatistics";
  statistics: FloodStatistics;
}

export interface SetCliArgs {
  messageType: "SetCliArgs";
  cliArgs: CliArgsFlood;
  processFetchCount: number; //cliArgs.fetchCount is fairly divided over all processes
  parallelFetchCount: number; //cliArgs.parallel is fairly divided over all processes
  index?: number; //cliArgs.filenameIndexing is divided over all processes so no duplicates are used
  processIndex: number;
}

export interface SetFloodState {
  messageType: "SetFloodState";
  authCacheContent: string; //AuthCache keys don't transform into JSON cleanly
  pods: PodAndOwnerInfo[]; //doesn't contain anything that doesn't cleanly transform into JSON and back
}

export interface RunStep {
  messageType: "RunStep";
  stepName: StepName;
}

export interface StopWorker {
  messageType: "StopWorker";
}

export type WorkerMsg = WorkerAnnounce | ReportStepDone | ReportFloodStatistics;

export type ControllerMsg = SetCliArgs | RunStep | SetFloodState | StopWorker;
