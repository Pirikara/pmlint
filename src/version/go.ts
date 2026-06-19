import type { ParsedVersionSpec } from "../model/types.js";

/**
 * Parse a Go module version (the version in a `go.mod` require line).
 *
 * Go modules are deterministic by design: `require` lines carry concrete
 * versions (`v1.2.3`) or pseudo-versions pinned to a commit
 * (`v0.0.0-20210101000000-abcdef123456`). There are no ranges, so specs are
 * effectively always exact.
 */
export function parseGoVersion(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();
  if (spec === "") {
    return base("empty");
  }
  // Pseudo-version: vX.Y.Z-<timestamp>-<commit> → pinned to a commit.
  if (/^v\d+\.\d+\.\d+(-0\.)?\d{14}-[0-9a-f]{12}/.test(spec)) {
    return base("exact");
  }
  // Standard semantic version (optionally with +incompatible / pre-release).
  if (/^v\d+\.\d+\.\d+([-+].+)?$/.test(spec)) {
    return base("exact");
  }
  return base("unknown");
}

function base(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return {
    kind,
    isFloating: kind === "empty",
    isUnbounded: false,
    isPinnedVcs: null,
  };
}
