/**
 * True when `dir` is the same as `ancestor` or nested under it.
 * Both are repo-relative POSIX dirs ("." is the repo root).
 */
export function isAtOrUnder(dir: string, ancestor: string): boolean {
  if (ancestor === ".") {
    return true;
  }
  if (dir === ancestor) {
    return true;
  }
  return dir.startsWith(`${ancestor}/`);
}
