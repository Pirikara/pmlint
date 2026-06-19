import type { ParsedVersionSpec } from "../model/types.js";

/**
 * Parse a Cargo (Rust) version requirement. Note: a bare `"1.2.3"` means
 * `^1.2.3` (caret) in Cargo, i.e. a bounded range — NOT an exact pin. Use
 * `"=1.2.3"` for exact.
 */
export function parseCargoVersion(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();
  if (spec === "") {
    return floating("empty");
  }
  if (spec === "*") {
    return floating("wildcard");
  }

  const clauses = spec
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  let caretTilde = false;
  let bare = false;
  let wildcard = false;
  let lowerOnly = false;
  let upper = false;
  let exact = false;

  for (const clause of clauses) {
    if (/^[\^~]/.test(clause)) caretTilde = true;
    else if (/\*/.test(clause)) wildcard = true; // e.g. 1.* (bounded)
    else if (/^=/.test(clause)) exact = true;
    else if (/^(>=|>)/.test(clause)) lowerOnly = true;
    else if (/^(<=|<)/.test(clause)) upper = true;
    else if (/^\d/.test(clause)) bare = true; // caret implied
  }

  if (caretTilde || bare || wildcard) {
    return base("range");
  }
  if (lowerOnly && !upper) {
    return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
  }
  if (exact && clauses.length === 1 && !lowerOnly && !upper) {
    return base("exact");
  }
  return base("range");
}

function base(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: false, isUnbounded: false, isPinnedVcs: null };
}

function floating(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: true, isUnbounded: false, isPinnedVcs: null };
}
