import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine, parseTomlSafe } from "../fs/parse.js";
import type {
  DependencyKind,
  DependencySpec,
  Lockfile,
  Manifest,
  PackageSurface,
  ParsedVersionSpec,
} from "../model/types.js";
import { parseCargoVersion } from "../version/cargo.js";
import type { AddDiagnostic, EcosystemAdapter } from "./types.js";

const SECTIONS: Array<{ key: string; kind: DependencyKind }> = [
  { key: "dependencies", kind: "dependency" },
  { key: "dev-dependencies", kind: "devDependency" },
  { key: "build-dependencies", kind: "dependency" },
];

export const rustAdapter: EcosystemAdapter = {
  ecosystem: "rust",
  buildSurfaces(input, addDiag) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      if (baseOf(file) !== "Cargo.toml") {
        continue;
      }
      const surface = buildSurface(input, file, addDiag);
      if (surface) {
        surfaces.push(surface);
      }
    }
    return surfaces;
  },
};

function buildSurface(input: Discovery, file: string, addDiag: AddDiagnostic): PackageSurface | null {
  const root = dirOf(file);
  const text = input.read(file) ?? "";
  const parsed = parseTomlSafe<Record<string, unknown>>(text);
  if (!parsed.ok) {
    addDiag({
      ruleId: "config/parse-error",
      severity: "error",
      message: "Could not parse Cargo.toml.",
      filePath: file,
    });
    return null;
  }
  const cargo = parsed.value ?? {};
  const manifest: Manifest = { path: file, kind: "Cargo.toml", raw: cargo };

  const lockfiles: Lockfile[] = [];
  const lockPath = `${root === "." ? "" : `${root}/`}Cargo.lock`;
  if (input.files.includes(lockPath)) {
    lockfiles.push({ path: lockPath, kind: "Cargo.lock" });
  }

  return {
    ecosystem: "rust",
    manager: "cargo",
    root,
    manifests: [manifest],
    lockfiles,
    configs: [],
    dependencySpecs: parseCargoDeps(cargo, file, text),
    detectedFrom: ["manifest"],
  };
}

function parseCargoDeps(
  cargo: Record<string, unknown>,
  manifestPath: string,
  text: string,
): DependencySpec[] {
  const specs: DependencySpec[] = [];
  for (const section of SECTIONS) {
    const deps = cargo[section.key];
    if (!deps || typeof deps !== "object") {
      continue;
    }
    for (const [name, value] of Object.entries(deps as Record<string, unknown>)) {
      specs.push({
        ecosystem: "rust",
        manager: "cargo",
        manifestPath,
        dependencyName: name,
        rawSpec: typeof value === "string" ? value : JSON.stringify(value),
        dependencyKind: section.kind,
        parsed: parseCargoValue(value),
        line: findLine(text, name),
      });
    }
  }
  return specs;
}

export function parseCargoValue(value: unknown): ParsedVersionSpec {
  if (typeof value === "string") {
    return parseCargoVersion(value);
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
    if (typeof table.version === "string") {
      return parseCargoVersion(table.version);
    }
  }
  // e.g. `{ workspace = true }` — resolved elsewhere, not floating.
  return { kind: "unknown", isFloating: false, isUnbounded: false, isPinnedVcs: null };
}
