import type { ParsedVersionSpec } from "../model/types.js";

export type ParsedRequirement = {
  name: string;
  /** The version specifier portion, e.g. `==2.32.3` or `>=2`. */
  specifier: string;
  spec: ParsedVersionSpec;
  /** True for a VCS / URL / local-path requirement (PEP 508 `name @ url`). */
  isUrlRequirement: boolean;
};

/**
 * Parse a single PEP 508 / PEP 440 requirement line (already stripped of
 * comments and `-r`/options handling) into a normalized requirement.
 *
 * Returns null for blank lines and option lines that are not requirements.
 */
export function parsePythonRequirement(rawLine: string): ParsedRequirement | null {
  let line = rawLine.trim();
  if (line === "" || line.startsWith("#")) {
    return null;
  }
  // Strip inline comments (a ` #` not inside a URL fragment).
  const commentIdx = line.indexOf(" #");
  if (commentIdx !== -1) {
    line = line.slice(0, commentIdx).trim();
  }
  // Strip a trailing per-requirement option block (e.g. ` --hash=...`).
  line = line.replace(/\s--hash=\S+/g, "").trim();

  // Skip pip option lines (`-r other.txt`, `--index-url ...`, `-e .`).
  if (line.startsWith("-") && !line.startsWith("-e")) {
    return null;
  }
  const editable = line.startsWith("-e");
  if (editable) {
    line = line.replace(/^-e\s+/, "").trim();
  }

  // PEP 508 direct reference: `name @ url` (VCS / URL / local path).
  const urlRefMatch = /^([A-Za-z0-9._-]+)\s*@\s*(.+)$/.exec(line);
  if (urlRefMatch) {
    const name = urlRefMatch[1]!;
    const url = urlRefMatch[2]!.trim();
    return {
      name,
      specifier: url,
      isUrlRequirement: true,
      spec: vcs(isPinnedPythonUrl(url)),
    };
  }

  // Bare VCS / URL without a name (editable installs, pip-style).
  if (/^(git\+|hg\+|svn\+|bzr\+|https?:\/\/|file:\/\/|\.{0,2}\/)/.test(line)) {
    return {
      name: line,
      specifier: line,
      isUrlRequirement: true,
      spec: vcs(isPinnedPythonUrl(line)),
    };
  }

  // Standard requirement: name[extras](specifier)
  const m = /^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$/.exec(line);
  if (!m) {
    return null;
  }
  const name = m[1]!;
  // Drop environment markers (`; python_version < "3.11"`).
  const specifier = (m[3] ?? "").split(";")[0]!.trim();

  return {
    name,
    specifier,
    isUrlRequirement: false,
    spec: parsePythonSpecifier(specifier),
  };
}

/**
 * Parse a PEP 440 version specifier set (the part after the name) into a
 * normalized {@link ParsedVersionSpec}.
 */
export function parsePythonSpecifier(rawSpecifier: string): ParsedVersionSpec {
  const specifier = rawSpecifier.trim();
  if (specifier === "" || specifier === "*") {
    return floating(specifier === "*" ? "wildcard" : "empty");
  }

  const clauses = specifier
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  let hasLowerOnly = false;
  let hasUpperBound = false;
  let hasCompatible = false;
  let hasExact = false;
  let hasWildcard = false;

  for (const clause of clauses) {
    const m = /^(===|==|~=|!=|>=|<=|>|<)?\s*(.+)$/.exec(clause);
    const op = m?.[1] ?? "==";
    const version = m?.[2] ?? "";
    switch (op) {
      case "~=":
        // Compatible release: bounded above implicitly.
        hasCompatible = true;
        break;
      case "==":
      case "===":
        if (version.includes("*")) {
          hasWildcard = true;
        } else {
          hasExact = true;
        }
        break;
      case ">":
      case ">=":
        hasLowerOnly = true;
        break;
      case "<":
      case "<=":
        hasUpperBound = true;
        break;
      default:
        break;
    }
  }

  if (hasWildcard && !hasUpperBound && !hasLowerOnly) {
    return floating("wildcard");
  }
  if (hasCompatible) {
    return base("range");
  }
  if (hasExact && !hasLowerOnly && !hasUpperBound && clauses.length === 1) {
    return base("exact");
  }
  if (hasLowerOnly && !hasUpperBound) {
    return { kind: "unbounded-range", isFloating: false, isUnbounded: true, isPinnedVcs: null };
  }
  return base("range");
}

function isPinnedPythonUrl(url: string): boolean {
  // VCS reference pinned to a commit/tag: `...@<ref>` after the scheme.
  const vcsMatch = /^(git|hg|svn|bzr)\+.+@([^#]+)/.exec(url);
  if (vcsMatch) {
    const ref = vcsMatch[2]!;
    // 7-40 hex commit, or a vX.Y.Z / X.Y.Z tag.
    return /^[0-9a-f]{7,40}$/i.test(ref) || /^v?\d+(\.\d+)*$/.test(ref);
  }
  // Non-VCS https archive URLs are immutable references; treat as pinned.
  if (/^https?:\/\//.test(url)) {
    return true;
  }
  return false;
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
