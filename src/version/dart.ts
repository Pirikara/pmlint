import type { ParsedVersionSpec } from "../model/types.js";

/**
 * Parse a Dart/Flutter pub version constraint. A bare `1.2.3` is exact in pub;
 * `^1.2.3` is a caret range, `any` is a wildcard, and `>=1.0.0 <2.0.0` is a
 * space-separated range.
 */
export function parseDartConstraint(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();
  if (spec === "") {
    return floating("empty");
  }
  if (spec === "any") {
    return floating("wildcard");
  }
  if (/^\^/.test(spec)) {
    return base("range");
  }

  const parts = spec.split(/\s+/);
  let lower = false;
  let upper = false;
  for (const part of parts) {
    if (/^(>=|>)/.test(part)) lower = true;
    else if (/^(<=|<)/.test(part)) upper = true;
  }
  if (lower && !upper) {
    return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
  }
  if (lower || upper) {
    return base("range");
  }
  if (/^\d/.test(spec)) {
    return base("exact");
  }
  return base("unknown");
}

function base(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: false, isUnbounded: false, isPinnedVcs: null };
}

function floating(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: true, isUnbounded: false, isPinnedVcs: null };
}
