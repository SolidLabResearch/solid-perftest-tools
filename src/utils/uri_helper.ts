export function joinUri(base: string, extra: string): string {
  console.assert(
    base.startsWith("http"),
    `joinUri base should be an URL, not '${base}'`
  );
  if (base.endsWith("/")) {
    return `${base}${extra}`;
  } else {
    return `${base}/${extra}`;
  }
}

export function dropDir(startUrl: string): string {
  //drop one dir level in the url  (if a file is given, drop the filename)
  console.assert(
    startUrl.startsWith("http"),
    `dropDir base should be an URL, not '${startUrl}'`
  );
  const baseUrl = startUrl.replace(/(https?:\/\/[^\/]+\/).*/, "$1");
  const path = startUrl.substring(baseUrl.length);

  if (!path || path.length === 0) {
    return startUrl;
  }

  const p = path.endsWith("/") ? path.substring(0, path.length - 1) : path;

  if (!p.includes("/")) return baseUrl;

  const newPath = p.replace(/(.*\/)[^\/]*/, "$1");

  return `${baseUrl}${newPath}`;
}
