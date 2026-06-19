import type { ParsedVersionSpec } from "../model/types.js";

/**
 * Parse a NuGet (.NET) version. A bare `1.2.3` is a minimum that resolves to the
 * lowest available match — treated as a normal pin (exact). Floating versions
 * use `*` (`1.*`, `*`); bracket notation gives explicit ranges (`[1.0,2.0)`).
 */
export function parseNuGetVersion(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();
  if (spec === "") {
    return floating("empty");
  }
  if (spec === "*" || /\*/.test(spec)) {
    return floating("wildcard"); // 1.*, 1.2.*, *
  }
  if (/^[[(]/.test(spec)) {
    // Single hard requirement, e.g. [1.2.3].
    if (/^\[[^,\])]+\]$/.test(spec)) {
      return base("exact");
    }
    // Empty upper bound, e.g. [1.0,).
    if (/,\s*[\])]/.test(spec)) {
      return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
    }
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
