export function join_uri(base: string, extra: string) {
  console.assert(
    base.startsWith("http"),
    `join_uri base should be an URL, not '${base}'`
  );
  if (base.endsWith("/")) {
    return `${base}${extra}`;
  } else {
    return `${base}/${extra}`;
  }
}
