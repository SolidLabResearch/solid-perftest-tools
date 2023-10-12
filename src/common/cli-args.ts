#!/usr/bin/env node

export interface CliArgsCommon {
  verbosity_count: number;
  cssBaseUrl: string[];

  v1: (message?: any, ...optionalParams: any[]) => void;
  v2: (message?: any, ...optionalParams: any[]) => void;
  v3: (message?: any, ...optionalParams: any[]) => void;
}
