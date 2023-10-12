export function accountEmail(account: string): string {
  return `${account}@example.org`;
}

export interface ProvidedAccountInfo {
  index: number;
  username: string;
  password: string;
  podName: string; //defaults to username
  email: string; //default based on username
  // webID?: string;  //not (yet?) relevant
}
