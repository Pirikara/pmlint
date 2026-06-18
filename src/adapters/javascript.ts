import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine, parseJsonSafe } from "../fs/parse.js";
import { isAtOrUnder } from "../util/paths.js";
import type {
  DependencyKind,
  DependencySpec,
  DetectionSource,
  Lockfile,
  LockfileKind,
  Manifest,
  PackageManager,
  PackageManagerConfig,
  PackageManagerConfigKind,
  PackageSurface,
} from "../model/types.js";
import { parseJavaScriptSpec } from "../version/javascript.js";
import type { AddDiagnostic, EcosystemAdapter } from "./types.js";

const LOCKFILE_MANAGER: Record<string, { kind: LockfileKind; manager: PackageManager }> = {
  "package-lock.json": { kind: "package-lock.json", manager: "npm" },
  "npm-shrinkwrap.json": { kind: "npm-shrinkwrap.json", manager: "npm" },
  "pnpm-lock.yaml": { kind: "pnpm-lock.yaml", manager: "pnpm" },
  "yarn.lock": { kind: "yarn.lock", manager: "yarn" },
  "bun.lock": { kind: "bun.lock", manager: "bun" },
  "bun.lockb": { kind: "bun.lockb", manager: "bun" },
};

const CONFIG_KIND: Record<string, PackageManagerConfigKind> = {
  ".npmrc": ".npmrc",
  ".yarnrc.yml": ".yarnrc.yml",
  ".yarnrc.yaml": ".yarnrc.yml",
  "pnpm-workspace.yaml": "pnpm-workspace.yaml",
  "bunfig.toml": "bunfig.toml",
};

const CONFIG_MANAGER: Partial<Record<PackageManagerConfigKind, PackageManager>> = {
  ".yarnrc.yml": "yarn",
  "pnpm-workspace.yaml": "pnpm",
  "bunfig.toml": "bun",
  // .npmrc is "npm-like" and shared by npm/pnpm/yarn -> not decisive on its own.
};

const DEP_SECTIONS: Array<{ key: string; kind: DependencyKind }> = [
  { key: "dependencies", kind: "dependency" },
  { key: "devDependencies", kind: "devDependency" },
  { key: "peerDependencies", kind: "peerDependency" },
  { key: "optionalDependencies", kind: "optionalDependency" },
];

export const javascriptAdapter: EcosystemAdapter = {
  ecosystem: "javascript",
  buildSurfaces(input, addDiag) {
    const surfaces: PackageSurface[] = [];
    const manifestPaths = input.files.filter((f) => baseOf(f) === "package.json");

    for (const manifestPath of manifestPaths) {
      const root = dirOf(manifestPath);
      const surface = buildSurface(input, root, manifestPath, addDiag);
      if (surface) {
        surfaces.push(surface);
      }
    }
    inheritManagerFromAncestors(surfaces);
    return surfaces;
  },
};

/**
 * Workspace children typically declare the package manager only at the root.
 * Give each `unknown` surface the manager of its nearest ancestor surface.
 */
function inheritManagerFromAncestors(surfaces: PackageSurface[]): void {
  const known = surfaces.filter((s) => s.manager !== "unknown");
  for (const surface of surfaces) {
    if (surface.manager !== "unknown") {
      continue;
    }
    let best: PackageSurface | undefined;
    for (const candidate of known) {
      if (candidate.root === surface.root) {
        continue;
      }
      if (isAtOrUnder(surface.root, candidate.root)) {
        if (!best || candidate.root.length > best.root.length) {
          best = candidate;
        }
      }
    }
    if (best) {
      surface.manager = best.manager;
      surface.detectedFrom.push("config");
      for (const dep of surface.dependencySpecs) {
        dep.manager = best.manager;
      }
    }
  }
}

function buildSurface(
  input: Discovery,
  root: string,
  manifestPath: string,
  addDiag: AddDiagnostic,
): PackageSurface | null {
  const text = input.read(manifestPath);
  if (text === undefined) {
    return null;
  }

  const parsed = parseJsonSafe<Record<string, unknown>>(text);
  if (!parsed.ok) {
    addDiag({
      ruleId: "config/parse-error",
      severity: "error",
      message: "Could not parse package.json.",
      filePath: manifestPath,
    });
    return null;
  }
  const pkg = parsed.value ?? {};

  const manifest: Manifest = { path: manifestPath, kind: "package.json", raw: pkg };

  const detectedFrom: DetectionSource[] = ["manifest"];
  const lockfiles = collectLockfiles(input, root);
  const configs = collectConfigs(input, root);

  // Detection priority: packageManager > devEngines > lockfile > config.
  let manager: PackageManager | "unknown" = "unknown";
  let declaredManagerVersion: string | undefined;

  const pm = parsePackageManagerField(pkg.packageManager);
  if (pm) {
    manager = pm.manager;
    declaredManagerVersion = pm.raw;
    detectedFrom.push("packageManagerField");
  }

  if (manager === "unknown") {
    const dev = parseDevEngines(pkg.devEngines);
    if (dev) {
      manager = dev;
      detectedFrom.push("devEngines");
    }
  }

  if (manager === "unknown" && lockfiles.length > 0) {
    const fromLock = LOCKFILE_MANAGER[baseOf(lockfiles[0]!.path)]?.manager;
    if (fromLock) {
      manager = fromLock;
      detectedFrom.push("lockfile");
    }
  }

  if (manager === "unknown") {
    for (const config of configs) {
      const fromConfig = CONFIG_MANAGER[config.kind];
      if (fromConfig) {
        manager = fromConfig;
        detectedFrom.push("config");
        break;
      }
    }
  }

  const dependencySpecs = collectDependencySpecs(pkg, manifestPath, text, manager);

  return {
    ecosystem: "javascript",
    manager,
    root,
    manifests: [manifest],
    lockfiles,
    configs,
    dependencySpecs,
    detectedFrom,
    declaredManagerVersion,
  };
}

function collectLockfiles(input: Discovery, root: string): Lockfile[] {
  const out: Lockfile[] = [];
  for (const file of input.files) {
    if (dirOf(file) !== root) {
      continue;
    }
    const entry = LOCKFILE_MANAGER[baseOf(file)];
    if (entry) {
      out.push({ path: file, kind: entry.kind });
    }
  }
  return out;
}

function collectConfigs(input: Discovery, root: string): PackageManagerConfig[] {
  const out: PackageManagerConfig[] = [];
  for (const file of input.files) {
    const base = baseOf(file);
    const kind = CONFIG_KIND[base];
    if (!kind) {
      continue;
    }
    // .npmrc / .yarnrc / bunfig live in the package root; pnpm-workspace too.
    if (dirOf(file) !== root) {
      continue;
    }
    out.push({ path: file, kind, raw: input.read(file) });
  }
  return out;
}

function collectDependencySpecs(
  pkg: Record<string, unknown>,
  manifestPath: string,
  text: string,
  manager: PackageManager | "unknown",
): DependencySpec[] {
  const specs: DependencySpec[] = [];
  for (const section of DEP_SECTIONS) {
    const deps = pkg[section.key];
    if (!deps || typeof deps !== "object") {
      continue;
    }
    for (const [name, rawSpec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof rawSpec !== "string") {
        continue;
      }
      specs.push({
        ecosystem: "javascript",
        manager,
        manifestPath,
        dependencyName: name,
        rawSpec,
        dependencyKind: section.kind,
        parsed: parseJavaScriptSpec(rawSpec),
        line: findLine(text, `"${name}"`),
      });
    }
  }
  return specs;
}

export function parsePackageManagerField(
  value: unknown,
): { manager: PackageManager; raw: string } | null {
  if (typeof value !== "string") {
    return null;
  }
  // e.g. "pnpm@10.16.1" or "yarn@4.1.0+sha512..."
  const m = /^(npm|pnpm|yarn|bun)@/.exec(value.trim());
  if (!m) {
    return null;
  }
  return { manager: m[1] as PackageManager, raw: value.trim() };
}

function parseDevEngines(value: unknown): PackageManager | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const pm = (value as Record<string, unknown>).packageManager;
  const name =
    pm && typeof pm === "object"
      ? (pm as Record<string, unknown>).name
      : undefined;
  if (typeof name === "string" && ["npm", "pnpm", "yarn", "bun"].includes(name)) {
    return name as PackageManager;
  }
  return null;
}
