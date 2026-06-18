import type { ParsedVersionSpec } from "../model/types.js";

/**
 * Parse a RubyGems version requirement (the constraints passed to `gem`) into a
 * normalized {@link ParsedVersionSpec}.
 *
 * Accepts the constraint string only, e.g. `">= 7.0"`, `"~> 6.1"`,
 * `"= 1.2.3"`, or multiple comma-separated constraints `">= 1.0, < 2.0"`.
 * VCS sources (git:/github:) are handled separately by the Ruby adapter.
 */
export function parseRubyRequirement(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();

  if (spec === "") {
    return floating("empty");
  }

  const constraints = spec
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (constraints.length === 0) {
    return floating("empty");
  }

  let hasLowerOnly = false;
  let hasUpperBound = false;
  let hasPessimistic = false;
  let hasExact = false;

  for (const constraint of constraints) {
    const m = /^(~>|>=|<=|!=|>|<|=)?\s*(.+)$/.exec(constraint);
    const op = m?.[1] ?? "=";
    switch (op) {
      case "~>":
        // Pessimistic constraint: bounded above implicitly.
        hasPessimistic = true;
        break;
      case ">":
      case ">=":
        hasLowerOnly = true;
        break;
      case "<":
      case "<=":
        hasUpperBound = true;
        break;
      case "=":
        hasExact = true;
        break;
      default:
        break;
    }
  }

  if (hasPessimistic) {
    // `~>` is bounded; combined with anything it stays a (bounded) range.
    return base("range");
  }

  if (hasExact && !hasLowerOnly && !hasUpperBound) {
    return base("exact");
  }

  if (hasLowerOnly && !hasUpperBound) {
    return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
  }

  return base("range");
}

function base(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: false, isUnbounded: false, isPinnedVcs: null };
}

function floating(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: true, isUnbounded: false, isPinnedVcs: null };
}
