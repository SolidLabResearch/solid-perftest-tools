#!/usr/bin/env node

import yargs, { Arguments, CamelCaseKey } from "yargs";
import { hideBin } from "yargs/helpers";
import {
  CreateAccountMethod,
  createAccountMethodStrings,
  CreateAccountMethodStringsType,
} from "./account";

export enum AccountAction {
  UseExisting,
  Create,
  Auto,
}

export enum AccountSource {
  File,
  Template,
}

export enum SolidServerAccountApiVersion {
  NONE = "NONE", //No account API!
  CSS_V1 = "CSS_V1",
  CSS_V6 = "CSS_V6",
  CSS_V7 = "CSS_V7",
}

export interface CliArgsCommon {
  verbosity_count: number;

  accountAction: AccountAction;
  accountSource: AccountSource;
  accountSourceCount: number;
  accountSourceFile?: string;
  accountSourceTemplateUsername: string;
  accountSourceTemplatePass: string;
  accountSourceTemplateCreateAccountMethod?: CreateAccountMethod; //undefined = try to autodetect
  accountSourceTemplateCreateAccountUri: string;

  v1: (message?: any, ...optionalParams: any[]) => void;
  v2: (message?: any, ...optionalParams: any[]) => void;
  v3: (message?: any, ...optionalParams: any[]) => void;
}

let ya = yargs(hideBin(process.argv))
  .option("v", {
    group: "Base:",
    type: "count",
    description:
      "Verbosity. The more times this option is added, the more messages are printed.",
    demandOption: false,
  })
  //in the future, --url will not be mandatory, because you'll also be able to specify a file with SolidServerInfo, or a template and count (for example, for a hundred servers)
  .option("url", {
    group: "CSS Server:",
    alias: "u",
    type: "string",
    description: "Base URL of the CSS",
    demandOption: true,
    array: true,
  })

  .option("accounts", {
    group: "Accounts:",
    type: "string",
    choices: ["USE_EXISTING", "CREATE", "AUTO"],
    description:
      "Do accounts exist already, or do they need to be created? (AUTO will create them if they don't yet exist.)" +
      " Creating accounts includes creating a webID, and a pod.",
    default: "USE_EXISTING",
    demandOption: true,
  })
  .option("account-source", {
    group: "Accounts:",
    type: "string",
    choices: ["FILE", "TEMPLATE"],
    description:
      "Where to get the accounts to use or generate? A FILE with json info, or generate from TEMPLATE?",
    default: "TEMPLATE",
    demandOption: false,
  })
  .option("account-source-count", {
    group: "Accounts:",
    type: "number",
    description: "Number of users/pods to generate/populate",
    demandOption: false,
  })
  .option("account-source-file", {
    group: "Accounts:",
    type: "string",
    description:
      "The file from which to read JSON account info. Expected JSON: [{username: foo, password: bar}, ...]",
    demandOption: false,
  })
  .option("account-template-username", {
    group: "Accounts:",
    type: "string",
    description:
      "Template for the account username. The text {{NR}} is replaced by the user number.",
    default: "user{{NR}}",
    demandOption: false,
  })
  .option("account-template-password", {
    group: "Accounts:",
    type: "string",
    description:
      "Template for the account password. The text {{NR}} is replaced by the user number.",
    default: "pass",
    demandOption: false,
  })
  .option("account-template-create-account-method", {
    group: "Accounts:",
    type: "string",
    choices: createAccountMethodStrings,
    description:
      "Template for the account create method. One of NONE, CSS_V6, CSS_V7. Leave unspecified for auto detect.",
    default: undefined,
    demandOption: false,
  })
  .option("account-template-create-account-uri", {
    group: "Accounts:",
    type: "string",
    description:
      "Template for the account create URI. " +
      "This specifies the server, but also the path on the server of the account create endpoint.",
    demandOption: false,
  })

  .help()
  .check((argvc, options) => {
    if (argvc.url.length < 1) {
      return "--url should be specified at least once";
    }

    if (argvc.accountSource == "FILE" && !argvc.accountSourceFile) {
      return "--account-source ${argvc.accountSource} requires --account-source-file";
    }
    if (argvc.accountSource == "TEMPLATE" && !argvc.accountSourceCount) {
      return `--account-source ${argvc.accountSource} requires --account-source-count`;
    }
    if (
      argvc.accountSource == "TEMPLATE" &&
      argvc.accountTemplateCreateAccountMethod &&
      argvc.accountTemplateCreateAccountMethod != "NONE" &&
      !argvc.accountTemplateCreateAccountUri
    ) {
      return `--account-template-create-account-method ${argvc.accountTemplateCreateAccountMethod} requires --account-template-create-account-uri`;
    }
    if (
      argvc.accountSource == "TEMPLATE" &&
      !argvc.accountTemplateCreateAccountMethod &&
      !argvc.accountTemplateCreateAccountUri
    ) {
      return `--account-source ${argvc.accountSource} requires --account-template-create-account-uri (or --account-template-create-account-method NONE)`;
    }

    if (argvc.generateFixedSize && !argvc.userCount) {
      return "--generate-fixed-size requires --user-count";
    }
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
      !argvc.generateFromDir &&
      !argvc.generateVariableSize &&
      !argvc.generateRdf &&
      !argvc.generateFixedSize
    ) {
      return "select at least one --generate-xxx option";
    }
    return true;
  });

type ArgvCommonType = typeof ya;
// type ParsedArgvCommonType = {
//   [key in keyof Arguments<ArgvCommonType> as
//     | key
//     | CamelCaseKey<key>]: Arguments<ArgvCommonType>[key];
// };
type ParsedArgvCommonType = {
  v: number;
  url: string[];
  accounts: string;
  accountSource: string;
  accountSourceCount: number | undefined;
  accountSourceFile: string | undefined;
  accountTemplateUsername: string;
  accountTemplatePassword: string;
  accountTemplateCreateAccountMethod?: CreateAccountMethodStringsType;
  accountTemplateCreateAccountUri?: string;
};

export function getArgvCommon(): ArgvCommonType {
  return ya;
}

export function processYargsCommon(argv: ParsedArgvCommonType): CliArgsCommon {
  const accountAction =
    argv.accounts == "USE_EXISTING"
      ? AccountAction.UseExisting
      : argv.accounts == "CREATE"
      ? AccountAction.Create
      : argv.accounts == "AUTO"
      ? AccountAction.Auto
      : null;
  const accountSource =
    argv.accountSource == "TEMPLATE"
      ? AccountSource.Template
      : argv.accountSource == "FILE"
      ? AccountSource.File
      : null;
  if (accountAction === null) {
    //this should not happen
    throw new Error(`--accounts ${argv.accounts} is invalid`);
  }
  if (accountSource === null) {
    //this should not happen
    throw new Error(`--account-source ${argv.accountSource} is invalid`);
  }
  if (accountSource == AccountSource.Template) {
    if (!argv.accountTemplateCreateAccountUri) {
      throw new Error(
        `--account-source-template-create-account-uri is required for --account-source ${argv.accountSource}`
      );
    }
  }

  return {
    verbosity_count: argv.v,

    accountAction,
    accountSource,
    accountSourceCount: argv.accountSourceCount || 1,
    accountSourceFile: argv.accountSourceFile,
    accountSourceTemplateUsername: argv.accountTemplateUsername,
    accountSourceTemplatePass: argv.accountTemplatePassword,
    accountSourceTemplateCreateAccountMethod:
      argv.accountTemplateCreateAccountMethod
        ? CreateAccountMethod[argv.accountTemplateCreateAccountMethod]
        : undefined,
    accountSourceTemplateCreateAccountUri:
      argv.accountTemplateCreateAccountUri!,

    v3: (message?: any, ...optionalParams: any[]) => {
      if (argv.v >= 3) console.log(message, ...optionalParams);
    },
    v2: (message?: any, ...optionalParams: any[]) => {
      if (argv.v >= 2) console.log(message, ...optionalParams);
    },
    v1: (message?: any, ...optionalParams: any[]) => {
      if (argv.v >= 1) console.log(message, ...optionalParams);
    },
  };
}
