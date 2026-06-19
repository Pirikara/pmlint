import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { PackageEcosystem, Severity } from "../model/types.js";
import { isKnownRuleId } from "../rules/ids.js";
import { DEFAULT_PRESET, isPresetName, presetRules } from "./presets.js";
import type { PresetName, RawConfig, ResolvedConfig } from "./types.js";

export const CONFIG_FILE_NAMES = [
  "pmlint.yml",
  "pmlint.yaml",
  ".pmlint.yml",
  ".pmlint.yaml",
] as const;

/** Thrown for invalid config / parse errors (CLI maps this to exit code 2). */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export function discoverConfigPath(root: string): string | undefined {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function defaultConfig(): ResolvedConfig {
  return {
    projectType: "app",
    ecosystems: { javascript: true, ruby: true, python: true },
    ignore: [],
    failOnWarnings: false,
    rules: presetRules(DEFAULT_PRESET),
    options: {
      requireExactPackageManagerVersion: false,
      minReleaseAgeSeconds: 0,
      minCooldownDays: 7,
    },
  };
}

export type LoadConfigOptions = {
  /** An explicit `--config` path (authoritative; skips repo-local discovery). */
  configPath?: string;
  /** Ignore any repo-local pmlint.yml (audit/fleet mode). */
  noRepoConfig?: boolean;
  /** Environment to read PMLINT_CONFIG from (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
};

/**
 * Load and resolve configuration for a repository root.
 *
 * Precedence (highest first):
 *   1. `--config <path>`            explicit external policy
 *   2. `PMLINT_CONFIG` env var      external policy for fleet runs
 *   3. repo-local pmlint.yml        unless `noRepoConfig` is set
 *   4. built-in defaults            (recommended preset)
 *
 * Cases 1 and 2 are "authoritative": the target repo's own config is never
 * read, so a scanned repo cannot weaken the policy applied to it.
 */
export function loadConfig(root: string, opts: LoadConfigOptions = {}): ResolvedConfig {
  const env = opts.env ?? process.env;
  const external = opts.configPath ?? env.PMLINT_CONFIG;

  let configPath: string | undefined;
  if (external) {
    configPath = path.resolve(external);
  } else if (opts.noRepoConfig) {
    configPath = undefined;
  } else {
    configPath = discoverConfigPath(root);
  }

  if (!configPath) {
    return defaultConfig();
  }
  if (!existsSync(configPath)) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }

  let raw: RawConfig;
  try {
    const text = readFileSync(configPath, "utf8");
    raw = (parseYaml(text) ?? {}) as RawConfig;
  } catch (err) {
    throw new ConfigError(
      `Could not parse config ${configPath}: ${(err as Error).message}`,
    );
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`Config ${configPath} must be a YAML mapping.`);
  }

  return resolveConfig(raw, configPath);
}

export function resolveConfig(raw: RawConfig, configPath = "<inline>"): ResolvedConfig {
  const config = defaultConfig();

  // 1. extends: presets compose left-to-right.
  const extendsList = normalizeExtends(raw.extends, configPath);
  if (extendsList.length > 0) {
    config.rules = {};
    for (const preset of extendsList) {
      Object.assign(config.rules, presetRules(preset));
    }
    // app-strict implies an exact package-manager version pin.
    if (extendsList.includes("app-strict")) {
      config.options.requireExactPackageManagerVersion = true;
    }
  }

  // 2. project type.
  if (raw.project?.type) {
    config.projectType = raw.project.type;
  }

  // 3. ecosystem enable/disable.
  for (const eco of ["javascript", "ruby", "python"] as PackageEcosystem[]) {
    const enabled = raw.ecosystems?.[eco]?.enabled;
    if (typeof enabled === "boolean") {
      config.ecosystems[eco] = enabled;
    }
  }

  // 4. policy booleans -> rule severities (sugar over the rules map).
  applyPolicy(config.rules, raw);

  // 5. explicit rule overrides win over everything.
  if (raw.rules) {
    for (const [id, severity] of Object.entries(raw.rules)) {
      if (!isKnownRuleId(id)) {
        throw new ConfigError(`Unknown rule id in ${configPath}: "${id}"`);
      }
      if (!isSeverity(severity)) {
        throw new ConfigError(
          `Invalid severity for "${id}" in ${configPath}: "${String(severity)}" (use off|warn|error)`,
        );
      }
      config.rules[id] = severity;
    }
  }

  if (Array.isArray(raw.ignore)) {
    config.ignore = raw.ignore.filter((p): p is string => typeof p === "string");
  }
  if (typeof raw.ci?.failOnWarnings === "boolean") {
    config.failOnWarnings = raw.ci.failOnWarnings;
  }
  if (typeof raw.requireExactPackageManagerVersion === "boolean") {
    config.options.requireExactPackageManagerVersion = raw.requireExactPackageManagerVersion;
  }
  if (typeof raw.minReleaseAgeSeconds === "number") {
    config.options.minReleaseAgeSeconds = raw.minReleaseAgeSeconds;
  }
  if (typeof raw.dependabot?.minCooldownDays === "number") {
    config.options.minCooldownDays = raw.dependabot.minCooldownDays;
  }

  return config;
}

function normalizeExtends(value: RawConfig["extends"], configPath: string): PresetName[] {
  if (!value) {
    return [DEFAULT_PRESET];
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map((name) => {
    if (!isPresetName(name)) {
      throw new ConfigError(`Unknown preset in ${configPath} "extends": "${name}"`);
    }
    return name;
  });
}

function applyPolicy(rules: Record<string, Severity>, raw: RawConfig): void {
  const setIf = (cond: boolean | undefined, id: string, on: Severity, off: Severity = "off") => {
    if (typeof cond === "boolean") {
      rules[id] = cond ? on : off;
    }
  };

  setIf(raw.lockfile?.required, "lockfile/required", "error");
  setIf(raw.install?.forbidMutatingInstallInCi, "install/no-mutating-install-in-ci", "error");
  setIf(raw.install?.forbidUpdateCommandsInCi, "install/no-update-command-in-ci", "error");
  setIf(raw.dependencies?.forbidFloatingVersions, "deps/no-floating-version", "error");
  setIf(raw.dependencies?.forbidDistTags, "deps/no-dist-tag", "error");
  setIf(raw.dependencies?.forbidUnboundedRanges, "deps/no-unbounded-range", "error");
  setIf(raw.dependencies?.forbidUnpinnedVcsSources, "deps/no-unpinned-vcs-source", "error");
  setIf(raw.dependabot?.required, "dependabot/config-present", "error");
  setIf(
    raw.dependabot?.requireCoverageForAllManifests,
    "dependabot/directories-cover-manifests",
    "error",
  );
  setIf(
    raw.dependabot?.requireGithubActionsUpdates,
    "dependabot/github-actions-updates",
    "warn",
  );
  setIf(raw.registry?.forbidPlaintextTokens, "registry/no-plaintext-token", "error");
  setIf(raw.registry?.forbidInsecureRegistry, "registry/no-insecure-registry", "error");
}

function isSeverity(value: unknown): value is Severity {
  return value === "off" || value === "warn" || value === "error";
}
