import semver from "semver";
import type { ParsedVersionSpec } from "../model/types.js";

const KNOWN_DIST_TAGS = new Set([
  "latest",
  "next",
  "beta",
  "canary",
  "alpha",
  "rc",
  "dev",
  "experimental",
  "nightly",
  "edge",
  "insiders",
]);

/**
 * Parse an npm-style dependency spec (the value side of a `package.json`
 * dependency entry) into a normalized {@link ParsedVersionSpec}.
 *
 * Uses the canonical npm `semver` package so range semantics (caret, tilde,
 * x-ranges, hyphen ranges, comparator sets) match the package managers exactly.
 */
export function parseJavaScriptSpec(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();

  if (spec === "") {
    return floating("empty");
  }

  // Workspace / catalog protocols are intentionally non-versioned and resolved
  // by the package manager; they are not floating.
  if (/^(workspace|catalog):/.test(spec)) {
    return base("workspace");
  }

  // `npm:` aliases — re-parse the version portion after the aliased name.
  const aliasMatch = /^npm:(.+)$/.exec(spec);
  if (aliasMatch) {
    const inner = aliasMatch[1]!;
    const at = inner.lastIndexOf("@");
    const versionPart = at > 0 ? inner.slice(at + 1) : "";
    return parseJavaScriptSpec(versionPart);
  }

  if (isVcsSpec(spec)) {
    return vcs(isPinnedJsVcs(spec));
  }

  if (/^(file|link|portal):/.test(spec) || /^(\.{1,2})?\//.test(spec)) {
    return base("path");
  }

  if (/^https?:\/\//.test(spec)) {
    return base("url");
  }

  if (spec === "*" || spec.toLowerCase() === "x") {
    return floating("wildcard");
  }

  // A bare word that is not a valid range is treated as a dist tag.
  if (/^[a-z][a-z0-9._-]*$/i.test(spec) && !semver.validRange(spec)) {
    return {
      kind: "dist-tag",
      isFloating: true,
      isUnbounded: false,
      isPinnedVcs: null,
      distTag: spec,
    };
  }

  if (semver.valid(spec)) {
    return base("exact");
  }

  const range = semver.validRange(spec);
  if (range) {
    // `*` normalizes to a wildcard range; treat any all-encompassing range as wildcard.
    if (range === "*") {
      return floating("wildcard");
    }
    if (isUnboundedRange(spec)) {
      return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
    }
    return base("range");
  }

  return base("unknown");
}

function isVcsSpec(spec: string): boolean {
  return (
    /^(git|git\+ssh|git\+https?|git\+file|ssh):/.test(spec) ||
    /^(github|gitlab|bitbucket|gist):/.test(spec) ||
    /\.git(#.*)?$/.test(spec) ||
    // `user/repo` or `user/repo#ref` shorthand (GitHub).
    /^[\w.-]+\/[\w.-]+(#.+)?$/.test(spec)
  );
}

/**
 * A JS VCS spec is "pinned" when it references an immutable commit/tag.
 * `#semver:` ranges and bare branch refs are considered moving.
 */
function isPinnedJsVcs(spec: string): boolean {
  const hashIndex = spec.indexOf("#");
  if (hashIndex === -1) {
    return false; // no ref -> default branch -> moving
  }
  const ref = spec.slice(hashIndex + 1);
  if (ref.startsWith("semver:")) {
    // A semver range over tags is only pinned if it is an exact version.
    const v = ref.slice("semver:".length);
    return Boolean(semver.valid(v));
  }
  // A 7-40 char hex string is a commit SHA.
  if (/^[0-9a-f]{7,40}$/i.test(ref)) {
    return true;
  }
  // `vX.Y.Z` / `X.Y.Z` style tags are treated as immutable.
  return Boolean(semver.valid(ref.replace(/^v/, "")));
}

/**
 * True when every comparator in the range has only a lower bound (`>` / `>=`)
 * and there is no upper bound. Caret/tilde expand to bounded comparator sets,
 * so they are correctly excluded.
 */
function isUnboundedRange(spec: string): boolean {
  let r: semver.Range;
  try {
    r = new semver.Range(spec);
  } catch {
    return false;
  }
  let sawLowerBound = false;
  for (const comparatorSet of r.set) {
    for (const comparator of comparatorSet) {
      const op = comparator.operator;
      // The empty operator with a `0.0.0` semver is the "any" placeholder.
      if (op === "" && comparator.value === "") {
        continue;
      }
      if (op === "<" || op === "<=") {
        return false; // has an upper bound
      }
      if (op === ">" || op === ">=") {
        sawLowerBound = true;
      } else if (op === "" || op === "=") {
        // An exact comparator is bounded.
        return false;
      }
    }
  }
  return sawLowerBound;
}

function base(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: false, isUnbounded: false, isPinnedVcs: null };
}

function floating(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: true, isUnbounded: false, isPinnedVcs: null };
}

function vcs(isPinned: boolean): ParsedVersionSpec {
  return { kind: "vcs", isFloating: false, isUnbounded: false, isPinnedVcs: isPinned };
}
