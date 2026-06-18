import { baseOf } from "../fs/discovery.js";
import { parsePackageManagerField } from "../adapters/javascript.js";
import { parseTomlSafe, parseYamlSafe } from "../fs/parse.js";
import type {
  LockfileKind,
  PackageManager,
  PackageManagerConfig,
  PackageSurface,
} from "../model/types.js";
import type { Finding, Rule, RuleContext } from "./types.js";

const LOCKFILE_TO_MANAGER: Record<string, PackageManager> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

const EXPECTED_LOCKFILE: Record<PackageManager, string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock",
  bundler: "Gemfile.lock",
  pip: "requirements.txt",
  "pip-tools": "requirements.txt",
  poetry: "poetry.lock",
  uv: "uv.lock",
};

const CONFIG_TO_MANAGER: Partial<Record<string, PackageManager>> = {
  ".yarnrc.yml": "yarn",
  "pnpm-workspace.yaml": "pnpm",
  "bunfig.toml": "bun",
};

function jsSurfaces(ctx: RuleContext): PackageSurface[] {
  return ctx.state.packageSurfaces.filter(
    (s) => s.ecosystem === "javascript" && ctx.config.ecosystems.javascript,
  );
}

function declaredManager(surface: PackageSurface): PackageManager | undefined {
  const pkg = surface.manifests[0]?.raw as Record<string, unknown> | undefined;
  return parsePackageManagerField(pkg?.packageManager)?.manager;
}

function lockManagers(surface: PackageSurface): { manager: PackageManager; path: string }[] {
  return surface.lockfiles
    .map((l) => ({ manager: LOCKFILE_TO_MANAGER[l.kind as LockfileKind], path: l.path }))
    .filter((x): x is { manager: PackageManager; path: string } => Boolean(x.manager));
}

function configManagers(surface: PackageSurface): { manager: PackageManager; path: string }[] {
  return surface.configs
    .map((c) => ({ manager: CONFIG_TO_MANAGER[c.kind], path: c.path }))
    .filter((x): x is { manager: PackageManager; path: string } => Boolean(x.manager));
}

export const noForeignLockfiles: Rule = {
  id: "js/no-foreign-lockfiles",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of jsSurfaces(ctx)) {
      const locks = lockManagers(surface);
      const declared = declaredManager(surface);
      const expected = declared ?? (locks.length === 1 ? locks[0]!.manager : undefined);

      if (expected) {
        for (const lock of locks) {
          if (lock.manager !== expected) {
            findings.push({
              message: `This package root appears to use ${expected}, but ${baseOf(lock.path)} (a ${lock.manager} lockfile) also exists.`,
              filePath: lock.path,
              suggestion: `Remove the foreign lockfile. Expected lockfile: ${EXPECTED_LOCKFILE[expected]}.`,
              fix: {
                kind: "delete",
                filePath: lock.path,
                destructive: true,
                description: `Delete foreign lockfile ${baseOf(lock.path)}`,
              },
            });
          }
        }
      } else {
        const distinct = new Set(locks.map((l) => l.manager));
        if (distinct.size > 1) {
          for (const lock of locks) {
            findings.push({
              message: `Multiple package-manager lockfiles are present in the same root (${[...distinct].join(", ")}).`,
              filePath: lock.path,
              suggestion: "Keep a single lockfile and declare the package manager in package.json.",
            });
          }
        }
      }
    }
    return findings;
  },
};

export const singleManager: Rule = {
  id: "js/single-manager",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of jsSurfaces(ctx)) {
      const declared = declaredManager(surface);
      const locks = lockManagers(surface);
      const expected = declared ?? (locks.length === 1 ? locks[0]!.manager : undefined);
      if (!expected) {
        continue;
      }
      for (const cfg of configManagers(surface)) {
        if (cfg.manager !== expected) {
          findings.push({
            message: `Package root uses ${expected}, but ${baseOf(cfg.path)} configures ${cfg.manager}.`,
            filePath: cfg.path,
            suggestion: "Package manager declaration, lockfile, and config should all agree.",
          });
        }
      }
    }
    return findings;
  },
};

export const packageManagerPinned: Rule = {
  id: "js/package-manager-pinned",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of jsSurfaces(ctx)) {
      const manifest = surface.manifests[0];
      const pkg = manifest?.raw as Record<string, unknown> | undefined;
      const field = parsePackageManagerField(pkg?.packageManager);
      if (!field) {
        findings.push({
          message: "package.json does not declare a pinned packageManager.",
          filePath: manifest?.path,
          suggestion: 'Add e.g. "packageManager": "pnpm@10.16.1".',
        });
        continue;
      }
      if (ctx.config.options.requireExactPackageManagerVersion) {
        const version = field.raw.split("@")[1]?.split("+")[0] ?? "";
        if (!/^\d+\.\d+\.\d+/.test(version)) {
          findings.push({
            message: `packageManager "${field.raw}" is not pinned to an exact version.`,
            filePath: manifest?.path,
            suggestion: "Pin to an exact version such as pnpm@10.16.1.",
          });
        }
      }
    }
    return findings;
  },
};

export const releaseAgeGate: Rule = {
  id: "js/release-age-gate",
  check(ctx) {
    const findings: Finding[] = [];
    const threshold = ctx.config.options.minReleaseAgeSeconds;
    for (const surface of jsSurfaces(ctx)) {
      if (surface.manager === "unknown") {
        continue;
      }
      const seconds = readReleaseAgeSeconds(surface);
      if (seconds === undefined) {
        findings.push({
          message: `No minimum release-age gate is configured for ${surface.manager}.`,
          filePath: surface.manifests[0]?.path ?? surface.root,
          suggestion: "Configure a minimum release age to slow adoption of freshly published versions.",
        });
      } else if (threshold > 0 && seconds < threshold) {
        findings.push({
          message: `Minimum release-age gate (${seconds}s) is below the required ${threshold}s.`,
          filePath: surface.manifests[0]?.path ?? surface.root,
        });
      }
    }
    return findings;
  },
};

export const saveExactConfigured: Rule = {
  id: "js/save-exact-configured",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of jsSurfaces(ctx)) {
      if (surface.manager === "unknown") {
        continue;
      }
      if (!isSaveExactConfigured(surface)) {
        findings.push({
          message: `${surface.manager} is not configured to save exact dependency versions.`,
          filePath: surface.manifests[0]?.path ?? surface.root,
          suggestion: exactSuggestion(surface.manager),
        });
      }
    }
    return findings;
  },
};

function configOf(surface: PackageSurface, kind: string): PackageManagerConfig | undefined {
  return surface.configs.find((c) => c.kind === kind);
}

function parseNpmrc(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

function readReleaseAgeSeconds(surface: PackageSurface): number | undefined {
  switch (surface.manager) {
    case "npm": {
      const npmrc = configOf(surface, ".npmrc");
      if (!npmrc || typeof npmrc.raw !== "string") return undefined;
      const map = parseNpmrc(npmrc.raw);
      const v = map.get("minimum-release-age") ?? map.get("min-release-age");
      return v ? Number(v) : undefined;
    }
    case "pnpm": {
      const ws = configOf(surface, "pnpm-workspace.yaml");
      if (!ws || typeof ws.raw !== "string") return undefined;
      const parsed = parseYamlSafe<Record<string, unknown>>(ws.raw);
      const v = parsed.ok ? parsed.value?.minimumReleaseAge : undefined;
      return typeof v === "number" ? v * 60 : undefined; // pnpm uses minutes
    }
    case "yarn": {
      const yarnrc = configOf(surface, ".yarnrc.yml");
      if (!yarnrc || typeof yarnrc.raw !== "string") return undefined;
      const parsed = parseYamlSafe<Record<string, unknown>>(yarnrc.raw);
      const v = parsed.ok ? parsed.value?.npmMinimalAgeGate : undefined;
      return typeof v === "number" ? v * 60 : undefined;
    }
    case "bun": {
      const bunfig = configOf(surface, "bunfig.toml");
      if (!bunfig || typeof bunfig.raw !== "string") return undefined;
      const parsed = parseTomlSafe<Record<string, unknown>>(bunfig.raw);
      const install = parsed.ok
        ? (parsed.value?.install as Record<string, unknown> | undefined)
        : undefined;
      const v = install?.minimumReleaseAge;
      return typeof v === "number" ? v : undefined;
    }
    default:
      return undefined;
  }
}

function isSaveExactConfigured(surface: PackageSurface): boolean {
  switch (surface.manager) {
    case "npm":
    case "pnpm": {
      const npmrc = configOf(surface, ".npmrc");
      if (!npmrc || typeof npmrc.raw !== "string") return false;
      const map = parseNpmrc(npmrc.raw);
      return map.get("save-exact") === "true" || map.get("save-prefix") === "";
    }
    case "yarn": {
      const yarnrc = configOf(surface, ".yarnrc.yml");
      if (!yarnrc || typeof yarnrc.raw !== "string") return false;
      const parsed = parseYamlSafe<Record<string, unknown>>(yarnrc.raw);
      return parsed.ok && parsed.value?.defaultSemverRangePrefix === "";
    }
    case "bun": {
      const bunfig = configOf(surface, "bunfig.toml");
      if (!bunfig || typeof bunfig.raw !== "string") return false;
      const parsed = parseTomlSafe<Record<string, unknown>>(bunfig.raw);
      const install = parsed.ok
        ? (parsed.value?.install as Record<string, unknown> | undefined)
        : undefined;
      return install?.exact === true;
    }
    default:
      return true;
  }
}

function exactSuggestion(manager: PackageManager | "unknown"): string {
  switch (manager) {
    case "npm":
    case "pnpm":
      return "Set save-exact=true (or save-prefix=\"\") in .npmrc.";
    case "yarn":
      return 'Set defaultSemverRangePrefix: "" in .yarnrc.yml.';
    case "bun":
      return "Set install.exact = true in bunfig.toml.";
    default:
      return "Configure the package manager to save exact versions.";
  }
}

export const javascriptRules: Rule[] = [
  noForeignLockfiles,
  singleManager,
  packageManagerPinned,
  releaseAgeGate,
  saveExactConfigured,
];
