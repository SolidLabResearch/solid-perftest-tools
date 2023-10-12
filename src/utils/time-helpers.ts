export function fromNow(d?: Date | null): null | string {
  if (!d) {
    return null;
  }
  const now = new Date();
  const s = (d.getTime() - now.getTime()) / 1000;
  if (s > 0) {
    return `in ${s}s`;
  } else {
    return `${-s}s ago`;
  }
}
