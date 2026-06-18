import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import path from "node:path";
import type {
  DependencySpec,
  Lockfile,
  Manifest,
  ManifestKind,
  PackageManagerConfig,
  PackageSurface,
  ParsedVersionSpec,
} from "../model/types.js";
import { parseRubyRequirement } from "../version/ruby.js";
import type { EcosystemAdapter } from "./types.js";

export const rubyAdapter: EcosystemAdapter = {
  ecosystem: "ruby",
  buildSurfaces(input) {
    const roots = new Set<string>();
    for (const file of input.files) {
      const base = baseOf(file);
      if (base === "Gemfile" || base.endsWith(".gemspec")) {
        roots.add(dirOf(file));
      }
    }

    const surfaces: PackageSurface[] = [];
    for (const root of roots) {
      surfaces.push(buildSurface(input, root));
    }
    return surfaces;
  },
};

function buildSurface(input: Discovery, root: string): PackageSurface {
  const manifests: Manifest[] = [];
  const lockfiles: Lockfile[] = [];
  const configs: PackageManagerConfig[] = [];
  const dependencySpecs: DependencySpec[] = [];

  const bundleConfigDir = path.posix.join(root, ".bundle");

  for (const file of input.files) {
    const base = baseOf(file);
    const dir = dirOf(file);

    if (dir === root && base === "Gemfile") {
      const text = input.read(file) ?? "";
      manifests.push({ path: file, kind: "Gemfile", raw: text });
      dependencySpecs.push(...parseGemfile(text, file));
    } else if (dir === root && base.endsWith(".gemspec")) {
      const text = input.read(file) ?? "";
      manifests.push({ path: file, kind: "gemspec", raw: text });
      dependencySpecs.push(...parseGemspec(text, file));
    } else if (dir === root && base === "Gemfile.lock") {
      lockfiles.push({ path: file, kind: "Gemfile.lock" });
    } else if (dir === bundleConfigDir && base === "config") {
      configs.push({ path: file, kind: ".bundle/config", raw: input.read(file) });
    }
  }

  return {
    ecosystem: "ruby",
    manager: "bundler",
    root,
    manifests,
    lockfiles,
    configs,
    dependencySpecs,
    detectedFrom: ["manifest"],
  };
}

/** Parse `gem` declarations out of a Gemfile (regex-based, MVP scope). */
export function parseGemfile(text: string, manifestPath: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = stripComment(rawLine);
    const m = /^\s*gem\s+(['"])(.+?)\1\s*(.*)$/.exec(line);
    if (!m) {
      return;
    }
    const name = m[2]!;
    const rest = m[3] ?? "";
    specs.push({
      ecosystem: "ruby",
      manager: "bundler",
      manifestPath,
      dependencyName: name,
      rawSpec: rest.trim(),
      dependencyKind: "dependency",
      parsed: parseGemArgs(rest),
      line: index + 1,
    });
  });

  return specs;
}

/** Parse gemspec `add_*_dependency` declarations. */
export function parseGemspec(text: string, manifestPath: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = stripComment(rawLine);
    const m =
      /\.add(?:_runtime|_development)?_dependency\s+(['"])(.+?)\1\s*(.*)$/.exec(line);
    if (!m) {
      return;
    }
    const name = m[2]!;
    const rest = (m[3] ?? "").replace(/\)\s*$/, "");
    specs.push({
      ecosystem: "ruby",
      manager: "bundler",
      manifestPath,
      dependencyName: name,
      rawSpec: rest.trim(),
      dependencyKind: "dependency",
      parsed: parseGemArgs(rest),
      line: index + 1,
    });
  });

  return specs;
}

/**
 * Parse the arguments following a gem name into a normalized spec.
 * Handles version constraints, git/github/path sources, and branch/tag/ref.
 */
function parseGemArgs(rest: string): ParsedVersionSpec {
  const segments = splitArgs(rest);

  const versionConstraints: string[] = [];
  const options: Record<string, string> = {};

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed === "") {
      continue;
    }
    // New hash syntax: `key: "value"`
    const newHash = /^([A-Za-z_]+):\s*(.+)$/.exec(trimmed);
    // Old hash syntax: `:key => "value"`
    const oldHash = /^:([A-Za-z_]+)\s*=>\s*(.+)$/.exec(trimmed);
    if (newHash) {
      options[newHash[1]!] = unquote(newHash[2]!);
      continue;
    }
    if (oldHash) {
      options[oldHash[1]!] = unquote(oldHash[2]!);
      continue;
    }
    const literal = unquote(trimmed);
    if (literal !== trimmed || /^['"]/.test(trimmed)) {
      versionConstraints.push(literal);
    }
  }

  const isVcs = "git" in options || "github" in options || "gitlab" in options || "bitbucket" in options;
  if (isVcs) {
    const pinned = Boolean(options.tag || options.ref);
    return { kind: "vcs", isFloating: false, isUnbounded: false, isPinnedVcs: pinned };
  }
  if ("path" in options) {
    return { kind: "path", isFloating: false, isUnbounded: false, isPinnedVcs: null };
  }

  return parseRubyRequirement(versionConstraints.join(", "));
}

/** Split a comma-separated argument list, respecting quotes. */
function splitArgs(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of input) {
    if (quote) {
      current += ch;
      if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") {
    out.push(current);
  }
  return out;
}

function unquote(value: string): string {
  const m = /^(['"])(.*)\1$/.exec(value.trim());
  return m ? m[2]! : value.trim();
}

function stripComment(line: string): string {
  const idx = line.indexOf("#");
  return idx === -1 ? line : line.slice(0, idx);
}
