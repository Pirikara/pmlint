import type { ParsedVersionSpec } from "../model/types.js";

/**
 * Parse a Composer (PHP) version constraint, e.g. `^1.2`, `~1.2`, `1.2.*`,
 * `>=1.2`, `1.2.3`, `dev-main`, `*`, or alternatives joined by `||`.
 */
export function parseComposerConstraint(rawSpec: string): ParsedVersionSpec {
  // Strip stability flags like `@stable` / `@dev`.
  const spec = rawSpec.trim().replace(/@\w+\s*$/, "").trim();

  if (spec === "") {
    return floating("empty");
  }
  if (spec === "*") {
    return floating("wildcard");
  }

  // A branch reference (`dev-main`, `dev-feature/x`, or `1.x-dev`) is a moving target.
  if (/^dev-/.test(spec) || /-dev$/.test(spec)) {
    return {
      kind: "dist-tag",
      isFloating: true,
      isUnbounded: false,
      isPinnedVcs: null,
      distTag: spec,
    };
  }

  // Composer allows `||` (OR) and `,`/space (AND) between comparators.
  const clauses = spec
    .split(/\s*\|\|\s*|\s*\|\s*/)
    .flatMap((alt) => alt.split(/\s*,\s*|\s+/))
    .map((c) => c.trim())
    .filter(Boolean);

  let hasLowerOnly = false;
  let hasUpperBound = false;
  let hasCaretTilde = false;
  let hasWildcard = false;
  let hasExact = false;

  for (const clause of clauses) {
    if (/^[\^~]/.test(clause)) {
      hasCaretTilde = true;
    } else if (/[*]/.test(clause)) {
      hasWildcard = true; // e.g. 1.2.* (bounded)
    } else if (/^(>=|>)/.test(clause)) {
      hasLowerOnly = true;
    } else if (/^(<=|<)/.test(clause)) {
      hasUpperBound = true;
    } else if (/^(=)?\d/.test(clause) || /^v?\d/.test(clause)) {
      hasExact = true;
    }
  }

  // Caret/tilde and `1.2.*` are bounded ranges.
  if (hasCaretTilde || hasWildcard) {
    return base("range");
  }
  if (hasLowerOnly && !hasUpperBound) {
    return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
  }
  if (hasLowerOnly || hasUpperBound) {
    return base("range");
  }
  if (hasExact && clauses.length === 1) {
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
