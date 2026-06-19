import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine, parseJsonSafe } from "../fs/parse.js";
import type { DependencyKind, DependencySpec, Lockfile, Manifest, PackageSurface } from "../model/types.js";
import { parseComposerConstraint } from "../version/composer.js";
import type { AddDiagnostic, EcosystemAdapter } from "./types.js";

const SECTIONS: Array<{ key: string; kind: DependencyKind }> = [
  { key: "require", kind: "dependency" },
  { key: "require-dev", kind: "devDependency" },
];

export const phpAdapter: EcosystemAdapter = {
  ecosystem: "php",
  buildSurfaces(input, addDiag) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      if (baseOf(file) !== "composer.json") {
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
  const text = input.read(file);
  if (text === undefined) {
    return null;
  }
  const parsed = parseJsonSafe<Record<string, unknown>>(text);
  if (!parsed.ok) {
    addDiag({
      ruleId: "config/parse-error",
      severity: "error",
      message: "Could not parse composer.json.",
      filePath: file,
    });
    return null;
  }
  const composer = parsed.value ?? {};
  const manifest: Manifest = { path: file, kind: "composer.json", raw: composer };

  const lockfiles: Lockfile[] = [];
  const lockPath = `${root === "." ? "" : `${root}/`}composer.lock`;
  if (input.files.includes(lockPath)) {
    lockfiles.push({ path: lockPath, kind: "composer.lock" });
  }

  return {
    ecosystem: "php",
    manager: "composer",
    root,
    manifests: [manifest],
    lockfiles,
    configs: [],
    dependencySpecs: parseComposerDeps(composer, file, text),
    detectedFrom: ["manifest"],
  };
}

function parseComposerDeps(
  composer: Record<string, unknown>,
  manifestPath: string,
  text: string,
): DependencySpec[] {
  const specs: DependencySpec[] = [];
  for (const section of SECTIONS) {
    const deps = composer[section.key];
    if (!deps || typeof deps !== "object") {
      continue;
    }
    for (const [name, constraint] of Object.entries(deps as Record<string, unknown>)) {
      // Skip platform packages (php, ext-*, lib-*) — they are not real dependencies.
      if (name === "php" || /^(ext|lib)-/.test(name) || typeof constraint !== "string") {
        continue;
      }
      specs.push({
        ecosystem: "php",
        manager: "composer",
        manifestPath,
        dependencyName: name,
        rawSpec: constraint,
        dependencyKind: section.kind,
        parsed: parseComposerConstraint(constraint),
        line: findLine(text, `"${name}"`),
      });
    }
  }
  return specs;
}
