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

export function accountEmail(account: string): string {
  return `${account}@example.org`;
}

export enum CreateAccountMethod {
  NONE = "NONE",
  CSS_V6 = "CSS_V6",
  CSS_V7 = "CSS_V7",
}
export type CreateAccountMethodStringsType = keyof typeof CreateAccountMethod;
export const createAccountMethodStrings: CreateAccountMethodStringsType[] = [
  "NONE",
  "CSS_V6",
  "CSS_V7",
];

export interface AccountCreateOrder {
  //Create a linked WebID, Idp and pod, using an identity provider solid server like CSS
  index: number;
  username: string;
  password: string;
  podName: string; //defaults to username
  email: string; //default based on username

  //AccountCreateOrder specific
  createAccountMethod?: CreateAccountMethod; //undefined if unknown, NONE if there is none. Default: try to auto detect.
  createAccountUri?: string; //for CSS, this is typically ${serverRootUri}/idp/register/ or ${serverRootUri}/.account/

  // webID?: string;  //this does not support using a custom preexisting WebID
}

export enum MachineLoginMethod {
  NONE = "NONE", //No way to login without user interaction
  CSS_V6 = "CSS_V6",
  CSS_V7 = "CSS_V7",
}
export type MachineLoginMethodStringsType = keyof typeof MachineLoginMethod;
export const MachineLoginMethodStrings: MachineLoginMethodStringsType[] = [
  "NONE",
  "CSS_V6",
  "CSS_V7",
];

export interface PodAndOwnerInfo {
  index: number;

  //Login info
  username: string;
  password: string;
  email: string; //default based on username

  //WebID
  webID: string; //This is typically a resource in pod, and for CSS this typically is ${serverRootUri}/${podName}/profile/card#me

  //Identity Provider (IdP)
  oidcIssuer: string; //uri
  machineLoginMethod?: MachineLoginMethod; //undefined if unknown, NONE if there is none
  machineLoginUri?: string; //for CSS, this is typically ${serverRootUri}/idp/credentials/ or ${serverRootUri}/.account/credentials/

  //pod
  // podName: string;  //info not really relevant or useful
  podUri: string; //for CSS, this is typically  ${serverRootUri}/${podName}/   (needs to end with /)
}
