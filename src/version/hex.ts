import type { ParsedVersionSpec } from "../model/types.js";

/**
 * Parse an Elixir/Hex version requirement, e.g. `~> 1.7.0`, `>= 3.0.0`,
 * `== 1.0.0`, `1.14.0`, or combinations joined by `and`/`or`.
 */
export function parseHexConstraint(rawSpec: string): ParsedVersionSpec {
  const spec = rawSpec.trim();
  if (spec === "") {
    return floating("empty");
  }

  const clauses = spec
    .split(/\s+(?:and|or)\s+|,/)
    .map((c) => c.trim())
    .filter(Boolean);

  let pessimistic = false;
  let lowerOnly = false;
  let upper = false;
  let exact = false;

  for (const clause of clauses) {
    const m = /^(~>|>=|<=|==|!=|>|<)?\s*(.+)$/.exec(clause);
    const op = m?.[1] ?? "==";
    switch (op) {
      case "~>":
        pessimistic = true;
        break;
      case ">=":
      case ">":
        lowerOnly = true;
        break;
      case "<=":
      case "<":
        upper = true;
        break;
      case "==":
        exact = true;
        break;
      default:
        break;
    }
  }

  if (pessimistic) {
    return base("range");
  }
  if (exact && !lowerOnly && !upper) {
    return base("exact");
  }
  if (lowerOnly && !upper) {
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
