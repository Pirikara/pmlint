import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine, parseYamlSafe } from "../fs/parse.js";
import type {
  DependencyKind,
  DependencySpec,
  Lockfile,
  Manifest,
  PackageSurface,
  ParsedVersionSpec,
} from "../model/types.js";
import { parseDartConstraint } from "../version/dart.js";
import type { AddDiagnostic, EcosystemAdapter } from "./types.js";

const SECTIONS: Array<{ key: string; kind: DependencyKind }> = [
  { key: "dependencies", kind: "dependency" },
  { key: "dev_dependencies", kind: "devDependency" },
];

export const dartAdapter: EcosystemAdapter = {
  ecosystem: "dart",
  buildSurfaces(input, addDiag) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      if (baseOf(file) !== "pubspec.yaml") {
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
  const parsed = parseYamlSafe<Record<string, unknown>>(text);
  if (!parsed.ok) {
    addDiag({
      ruleId: "config/parse-error",
      severity: "error",
      message: "Could not parse pubspec.yaml.",
      filePath: file,
    });
    return null;
  }
  const pubspec = parsed.value ?? {};
  const manifest: Manifest = { path: file, kind: "pubspec.yaml", raw: pubspec };

  const lockfiles: Lockfile[] = [];
  const lockPath = `${root === "." ? "" : `${root}/`}pubspec.lock`;
  if (input.files.includes(lockPath)) {
    lockfiles.push({ path: lockPath, kind: "pubspec.lock" });
  }

  return {
    ecosystem: "dart",
    manager: "pub",
    root,
    manifests: [manifest],
    lockfiles,
    configs: [],
    dependencySpecs: parsePubspecDeps(pubspec, file, text),
    detectedFrom: ["manifest"],
  };
}

function parsePubspecDeps(
  pubspec: Record<string, unknown>,
  manifestPath: string,
  text: string,
): DependencySpec[] {
  const specs: DependencySpec[] = [];
  for (const section of SECTIONS) {
    const deps = pubspec[section.key];
    if (!deps || typeof deps !== "object") {
      continue;
    }
    for (const [name, value] of Object.entries(deps as Record<string, unknown>)) {
      const parsedSpec = parsePubValue(value);
      if (!parsedSpec) {
        continue; // sdk deps (e.g. flutter) have no version constraint
      }
      specs.push({
        ecosystem: "dart",
        manager: "pub",
        manifestPath,
        dependencyName: name,
        rawSpec: typeof value === "string" ? value : JSON.stringify(value),
        dependencyKind: section.kind,
        parsed: parsedSpec,
        line: findLine(text, `${name}:`),
      });
    }
  }
  return specs;
}

function parsePubValue(value: unknown): ParsedVersionSpec | null {
  if (value === null || value === undefined) {
    return { kind: "empty", isFloating: true, isUnbounded: false, isPinnedVcs: null };
  }
  if (typeof value === "string") {
    return parseDartConstraint(value);
  }
  if (typeof value === "object") {
    const table = value as Record<string, unknown>;
    if ("sdk" in table) {
      return null; // sdk: flutter — managed by the SDK
    }
    if ("git" in table) {
      const git = table.git;
      const ref = typeof git === "object" && git ? (git as Record<string, unknown>).ref : undefined;
      const pinned = typeof ref === "string" && /^[0-9a-f]{7,40}$|^v?\d+(\.\d+)*$/i.test(ref);
      return { kind: "vcs", isFloating: false, isUnbounded: false, isPinnedVcs: pinned };
    }
    if ("path" in table) {
      return { kind: "path", isFloating: false, isUnbounded: false, isPinnedVcs: null };
    }
    if (typeof table.version === "string") {
      return parseDartConstraint(table.version);
    }
  }
  return { kind: "unknown", isFloating: false, isUnbounded: false, isPinnedVcs: null };
}
