#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  CliArgsCommon,
  getArgvCommon,
  processYargsCommon,
} from "../common/cli-args.js";

export interface CliArgsPopulate extends CliArgsCommon {
  fileSize: number;
  fileCount: number;
  addAclFiles: boolean;
  addAcrFiles: boolean;
  dirDepth: number;
  userJsonOut?: string;
  addAcFilePerDir: boolean;
  addAcFilePerResource: boolean;
  generateVariableSize: boolean;
  generateVariableSizeOverrideSizes?: number[];
  generateFixedSize: boolean;
  generateRdf: boolean;
  generateFromDir: boolean;
  generatedDataBaseDir?: string;
  baseRdfFile?: string;
}

export function getCliArgs(): CliArgsPopulate {
  let ya = getArgvCommon()
    .usage("Usage: $0 --url <url> --generate-xxx --generate-yyy ...")

    .option("user-json-out", {
      group: "Generate users:",
      type: "string",
      description:
        "A file to write user info to in JSON format. (username/password, webID, pod root URL, ...)",
      demandOption: false,
    })
    .option("generate-variable-size", {
      group: "Generate Variable Size Content:",
      type: "boolean",
      description:
        "Generate 7 files with random data of increasing size: 10.rnd, ...  10_000_000.rnd",
      default: false,
      demandOption: false,
    })
    .option("generate-variable-size-override-sizes", {
      group: "Generate Variable Size Content:",
      type: "string",
      description:
        "Instead of 7 files, generate any number of files with the provided sizes. Expects a comma separated string of sizes",
      demandOption: false,
    })
    // .option("generate-variable-size-override-datatype", {
    //   group: "Generate Variable Size Content:",
    //   type: "string",
    //   description:
    //     "Instead of filling the files with random data, fill them with other types of data",
    //   demandOption: false,
    // })
    .option("generate-fixed-size", {
      group: "Generate Fixed Size Content:",
      type: "boolean",
      description:
        "Generate a configurable number of files of configurable fixed size",
      default: false,
      demandOption: false,
    })
    .option("file-count", {
      group: "Generate Fixed Size Content:",
      type: "number",
      description: "Number of files to generate",
      demandOption: false,
      default: 0,
      implies: ["generate-fixed-size"],
    })
    .option("file-size", {
      group: "Generate Fixed Size Content:",
      type: "number",
      description: "Size of files to generate",
      demandOption: false,
      default: 0,
      implies: ["generate-fixed-size"],
    })
    .option("generate-rdf", {
      group: "Generate RDF Content:",
      type: "boolean",
      description: "Generate RDF files with various content types",
      default: false,
      demandOption: false,
    })
    .option("base-rdf-file", {
      group: "Generate RDF Content:",
      type: "string",
      description:
        "Base RDF file to upload. Will be converted into various RDF file formats.",
      demandOption: false,
      implies: ["generate-rdf"],
    })
    .option("generate-from-dir", {
      group: "Use content from a directory:",
      type: "boolean",
      description:
        "Populate with existing content read from a specified directory",
      default: false,
      demandOption: false,
    })
    .option("add-acl-files", {
      group: "Generate Content:",
      type: "boolean",
      description:
        "Upload a corresponding .acl file for each generated file and/or dir",
      default: false,
      demandOption: false,
    })
    .option("add-acr-files", {
      group: "Generate Content:",
      type: "boolean",
      description:
        "Upload a corresponding .acr file for each generated file and/or dir",
      default: false,
      demandOption: false,
    })
    .option("add-ac-file-per-resource", {
      group: "Generate Content:",
      type: "boolean",
      description:
        "Upload a corresponding .acl/.acr file for each generated file. Use --no-add-ac-file-per-resource to set to false.",
      default: true,
      demandOption: false,
    })
    .option("add-ac-file-per-dir", {
      group: "Generate Content:",
      type: "boolean",
      description:
        "Upload a corresponding .acl/.acr file for each pod root and subdir. Use --no-add-ac-file-per-dir to set to false.",
      default: true,
      demandOption: false,
    })
    .option("dir-depth", {
      group: "Generate Content:",
      type: "number",
      description:
        "Put the generated content in this amount of nested subdirs. Use 0 for no subdirs (= files in pod root). " +
        "Subdirs will all be named 'data'. " +
        "Example generated file if this option is 2: https://example.com/user0/data/data/10.rnd",
      default: 0,
      demandOption: false,
    })
    .option("dir", {
      group: "Use content from a directory:",
      type: "string",
      description: "Dir with the generated data",
      demandOption: false,
      implies: ["generate-from-dir"],
    })
    .help()
    .check((argvc, options) => {
      if (argvc.generateFixedSize && !argvc.fileSize) {
        return "--generate-fixed-size requires --file-size";
      }
      if (argvc.generateFixedSize && !argvc.fileCount) {
        return "--generate-fixed-size requires --file-count";
      }
      if (argvc.generateFromDir && !argvc.dir) {
        return "--generate-from-dir requires --dir";
      }
      if (argvc.generateRdf && !argvc.baseRdfFile) {
        return "--generate-rdf requires --base-rdf-file";
      }
      if (
        argvc.accounts != "CREATE" &&
        !argvc.generateFromDir &&
        !argvc.generateVariableSize &&
        !argvc.generateRdf &&
        !argvc.generateFixedSize
      ) {
        return "select at least one --generate-xxx option, or create some users";
      }
      return true;
    })
    .wrap(120)
    .strict(true);
  // ya = ya.wrap(ya.terminalWidth());
  const argv = ya.parseSync();
  const commonCli = processYargsCommon(argv);

  return {
    ...commonCli,

    fileSize: argv.fileSize || 10,
    fileCount: argv.fileCount || 1,
    addAclFiles: argv.addAclFiles,
    addAcrFiles: argv.addAcrFiles,
    userJsonOut: argv.userJsonOut,
    dirDepth: argv.dirDepth || 0,
    addAcFilePerDir: argv.addAcFilePerDir,
    addAcFilePerResource: argv.addAcFilePerResource,
    generateVariableSize: argv.generateVariableSize,
    generateVariableSizeOverrideSizes: argv.generateVariableSizeOverrideSizes
      ?.split(",")
      .map((s) => +s),
    generateFixedSize: argv.generateFixedSize,
    generateRdf: argv.generateRdf,
    generateFromDir: argv.generateFromDir,
    generatedDataBaseDir:
      argv.source === "dir"
        ? argv.dir?.endsWith("/")
          ? argv.dir
          : argv.dir + "/"
        : undefined,
    baseRdfFile: argv.baseRdfFile,
  };
}
