import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine, parseTomlSafe } from "../fs/parse.js";
import type {
  DependencySpec,
  Lockfile,
  LockfileKind,
  Manifest,
  ManifestKind,
  PackageManager,
  PackageManagerConfig,
  PackageSurface,
  ParsedVersionSpec,
} from "../model/types.js";
import { parsePythonRequirement, parsePythonSpecifier } from "../version/python.js";
import type { AddDiagnostic, EcosystemAdapter } from "./types.js";

const PY_LOCK_KINDS: Record<string, LockfileKind> = {
  "poetry.lock": "poetry.lock",
  "uv.lock": "uv.lock",
  "pylock.toml": "pylock.toml",
};

export const pythonAdapter: EcosystemAdapter = {
  ecosystem: "python",
  buildSurfaces(input, addDiag) {
    const roots = new Set<string>();
    for (const file of input.files) {
      const base = baseOf(file);
      if (isPythonRootFile(base)) {
        roots.add(dirOf(file));
      }
    }

    const surfaces: PackageSurface[] = [];
    for (const root of roots) {
      const surface = buildSurface(input, root, addDiag);
      if (surface) {
        surfaces.push(surface);
      }
    }
    return surfaces;
  },
};

function isPythonRootFile(base: string): boolean {
  return (
    base === "pyproject.toml" ||
    base === "constraints.txt" ||
    /^requirements.*\.txt$/.test(base) ||
    /^requirements.*\.in$/.test(base)
  );
}

function buildSurface(
  input: Discovery,
  root: string,
  addDiag: AddDiagnostic,
): PackageSurface | null {
  const manifests: Manifest[] = [];
  const lockfiles: Lockfile[] = [];
  const configs: PackageManagerConfig[] = [];
  const dependencySpecs: DependencySpec[] = [];

  let hasPoetryLock = false;
  let hasUvLock = false;
  let hasRequirementsIn = false;
  let hasRequirementsTxt = false;
  let pyprojectTool: { poetry: boolean; uv: boolean; project: boolean } = {
    poetry: false,
    uv: false,
    project: false,
  };
  let requirementsTxtPath: string | undefined;

  for (const file of input.files) {
    if (dirOf(file) !== root) {
      continue;
    }
    const base = baseOf(file);
    const text = input.read(file) ?? "";

    if (base === "pyproject.toml") {
      const parsed = parseTomlSafe<Record<string, unknown>>(text);
      if (!parsed.ok) {
        addDiag({
          ruleId: "config/parse-error",
          severity: "error",
          message: "Could not parse pyproject.toml.",
          filePath: file,
        });
        continue;
      }
      const raw = parsed.value ?? {};
      manifests.push({ path: file, kind: "pyproject.toml", raw });
      configs.push({ path: file, kind: "pyproject.toml", raw });
      pyprojectTool = inspectPyproject(raw);
      dependencySpecs.push(...parsePyproject(raw, file, text));
    } else if (PY_LOCK_KINDS[base]) {
      lockfiles.push({ path: file, kind: PY_LOCK_KINDS[base]! });
      if (base === "poetry.lock") hasPoetryLock = true;
      if (base === "uv.lock") hasUvLock = true;
    } else if (/^requirements.*\.in$/.test(base)) {
      hasRequirementsIn = true;
      manifests.push({ path: file, kind: "requirements.in", raw: text });
      dependencySpecs.push(...parseRequirementsFile(text, file, "requirement"));
    } else if (/^requirements.*\.txt$/.test(base)) {
      hasRequirementsTxt = true;
      requirementsTxtPath = file;
      manifests.push({ path: file, kind: "requirements.txt", raw: text });
      dependencySpecs.push(...parseRequirementsFile(text, file, "requirement"));
    } else if (base === "constraints.txt") {
      manifests.push({ path: file, kind: "constraints.txt", raw: text });
    } else if (base === "pip.conf" || base === "pip.ini") {
      configs.push({ path: file, kind: base, raw: text });
    } else if (base === "poetry.toml" || base === "uv.toml") {
      configs.push({ path: file, kind: base, raw: text });
    }
  }

  if (manifests.length === 0) {
    return null;
  }

  const manager = detectManager({
    hasPoetryLock,
    hasUvLock,
    hasRequirementsIn,
    hasRequirementsTxt,
    pyprojectTool,
  });

  // For pip / pip-tools, a pinned requirements.txt is the lock-like surface.
  if ((manager === "pip" || manager === "pip-tools") && requirementsTxtPath) {
    lockfiles.push({ path: requirementsTxtPath, kind: "requirements.txt" });
  }

  return {
    ecosystem: "python",
    manager,
    root,
    manifests,
    lockfiles,
    configs,
    dependencySpecs,
    detectedFrom: ["manifest"],
  };
}

function detectManager(signals: {
  hasPoetryLock: boolean;
  hasUvLock: boolean;
  hasRequirementsIn: boolean;
  hasRequirementsTxt: boolean;
  pyprojectTool: { poetry: boolean; uv: boolean; project: boolean };
}): PackageManager {
  if (signals.hasPoetryLock || signals.pyprojectTool.poetry) {
    return "poetry";
  }
  if (signals.hasUvLock || signals.pyprojectTool.uv) {
    return "uv";
  }
  if (signals.hasRequirementsIn) {
    return "pip-tools";
  }
  return "pip";
}

function inspectPyproject(raw: Record<string, unknown>): {
  poetry: boolean;
  uv: boolean;
  project: boolean;
} {
  const tool = (raw.tool as Record<string, unknown> | undefined) ?? {};
  return {
    poetry: "poetry" in tool,
    uv: "uv" in tool,
    project: "project" in raw,
  };
}

function parsePyproject(
  raw: Record<string, unknown>,
  manifestPath: string,
  text: string,
): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const tool = (raw.tool as Record<string, unknown> | undefined) ?? {};

  // Poetry-style dependencies (table form).
  const poetry = tool.poetry as Record<string, unknown> | undefined;
  if (poetry) {
    collectPoetryDeps(poetry.dependencies, manifestPath, text, specs);
    const groups = poetry.group as Record<string, unknown> | undefined;
    if (groups) {
      for (const group of Object.values(groups)) {
        if (group && typeof group === "object") {
          collectPoetryDeps(
            (group as Record<string, unknown>).dependencies,
            manifestPath,
            text,
            specs,
          );
        }
      }
    }
  }

  // PEP 621 project.dependencies (array of PEP 508 strings).
  const project = raw.project as Record<string, unknown> | undefined;
  if (project) {
    collectPep621Deps(project.dependencies, manifestPath, text, specs);
    const optional = project["optional-dependencies"];
    if (optional && typeof optional === "object") {
      for (const arr of Object.values(optional as Record<string, unknown>)) {
        collectPep621Deps(arr, manifestPath, text, specs);
      }
    }
  }

  return specs;
}

function collectPoetryDeps(
  deps: unknown,
  manifestPath: string,
  text: string,
  out: DependencySpec[],
): void {
  if (!deps || typeof deps !== "object") {
    return;
  }
  for (const [name, value] of Object.entries(deps as Record<string, unknown>)) {
    if (name.toLowerCase() === "python") {
      continue; // the interpreter constraint, not a package
    }
    out.push({
      ecosystem: "python",
      manager: "poetry",
      manifestPath,
      dependencyName: name,
      rawSpec: typeof value === "string" ? value : JSON.stringify(value),
      dependencyKind: "dependency",
      parsed: parsePoetryValue(value),
      line: findLine(text, name),
    });
  }
}

function collectPep621Deps(
  arr: unknown,
  manifestPath: string,
  text: string,
  out: DependencySpec[],
): void {
  if (!Array.isArray(arr)) {
    return;
  }
  for (const entry of arr) {
    if (typeof entry !== "string") {
      continue;
    }
    const req = parsePythonRequirement(entry);
    if (!req) {
      continue;
    }
    out.push({
      ecosystem: "python",
      manager: "pip",
      manifestPath,
      dependencyName: req.name,
      rawSpec: entry,
      dependencyKind: "requirement",
      parsed: req.spec,
      line: findLine(text, entry) ?? findLine(text, req.name),
    });
  }
}

/** Parse a poetry dependency value (string spec or `{version,git,...}` table). */
export function parsePoetryValue(value: unknown): ParsedVersionSpec {
  if (typeof value === "string") {
    return parsePoetryVersionString(value);
  }
  if (value && typeof value === "object") {
    const table = value as Record<string, unknown>;
    if ("git" in table) {
      const pinned = Boolean(table.rev || table.tag);
      return { kind: "vcs", isFloating: false, isUnbounded: false, isPinnedVcs: pinned };
    }
    if ("path" in table) {
      return { kind: "path", isFloating: false, isUnbounded: false, isPinnedVcs: null };
    }
    if ("url" in table) {
      return { kind: "url", isFloating: false, isUnbounded: false, isPinnedVcs: true };
    }
    if (typeof table.version === "string") {
      return parsePoetryVersionString(table.version);
    }
  }
  return { kind: "unknown", isFloating: false, isUnbounded: false, isPinnedVcs: null };
}

/** Poetry version strings use caret/tilde in addition to PEP 440 operators. */
function parsePoetryVersionString(raw: string): ParsedVersionSpec {
  const v = raw.trim();
  if (v === "") {
    return { kind: "empty", isFloating: true, isUnbounded: false, isPinnedVcs: null };
  }
  if (v === "*") {
    return { kind: "wildcard", isFloating: true, isUnbounded: false, isPinnedVcs: null };
  }
  if (/^[\^~]/.test(v)) {
    return { kind: "range", isFloating: false, isUnbounded: false, isPinnedVcs: null };
  }
  if (/^\d/.test(v) && !/[<>=!~*]/.test(v)) {
    return { kind: "exact", isFloating: false, isUnbounded: false, isPinnedVcs: null };
  }
  return parsePythonSpecifier(v);
}

/** Parse a requirements.txt / .in file line by line. */
export function parseRequirementsFile(
  text: string,
  manifestPath: string,
  dependencyKind: "requirement",
): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const req = parsePythonRequirement(rawLine);
    if (!req) {
      return;
    }
    specs.push({
      ecosystem: "python",
      manager: "pip",
      manifestPath,
      dependencyName: req.name,
      rawSpec: req.specifier === "" ? req.name : `${req.name}${req.specifier}`,
      dependencyKind,
      parsed: req.spec,
      line: index + 1,
    });
  });

  return specs;
}
