import type { ParsedVersionSpec } from "../model/types.js";

/** Parse a Maven `<version>` value (exact, range, property, or LATEST/RELEASE). */
export function parseMavenVersion(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();
  if (spec === "") {
    return base("empty", true);
  }
  if (/^\$\{.*\}$/.test(spec)) {
    return base("unknown"); // unresolved property — don't guess
  }
  if (/^(LATEST|RELEASE)$/i.test(spec)) {
    return { kind: "dist-tag", isFloating: true, isUnbounded: false, isPinnedVcs: null, distTag: spec };
  }
  if (/^[[(]/.test(spec)) {
    return parseBracketRange(spec);
  }
  return base("exact");
}

/** Parse a Gradle version string (exact, dynamic `+`, `latest.*`, or range). */
export function parseGradleVersion(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim().replace(/!!$/, ""); // strip strict marker
  if (spec === "") {
    return base("empty", true);
  }
  if (/^\$\{.*\}$/.test(spec) || /^\$\w/.test(spec)) {
    return base("unknown");
  }
  if (spec === "+" || /\.\+$/.test(spec)) {
    return base("wildcard", true); // dynamic version
  }
  if (/^latest\./i.test(spec)) {
    return { kind: "dist-tag", isFloating: true, isUnbounded: false, isPinnedVcs: null, distTag: spec };
  }
  if (/^[[(]/.test(spec)) {
    return parseBracketRange(spec);
  }
  if (/^v?\d/.test(spec)) {
    return base("exact");
  }
  return base("unknown");
}

/** Maven/Gradle bracket ranges: `[1.0,2.0)`, `[1.0,)` (unbounded), `[1.5]` (exact). */
function parseBracketRange(spec: string): ParsedVersionSpec {
  // Single hard requirement, e.g. [1.5].
  if (/^\[[^,\])]+\]$/.test(spec)) {
    return base("exact");
  }
  // An empty upper bound (e.g. `[1.0,)`) means no upper limit.
  if (/,\s*[\])]/.test(spec)) {
    return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
  }
  return base("range");
}

function base(kind: ParsedVersionSpec["kind"], floating = false): ParsedVersionSpec {
  return { kind, isFloating: floating, isUnbounded: false, isPinnedVcs: null };
}
