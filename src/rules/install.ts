import type { CiInstallCommand, FileFix, PackageManager } from "../model/types.js";
import type { Finding, Rule } from "./types.js";

/**
 * Produce the frozen/locked form of a mutating install command, when a safe
 * in-place rewrite exists. Returns undefined for managers whose frozen behavior
 * needs out-of-line config (e.g. Bundler) or version resolution (pip hashes).
 */
function frozenReplacement(cmd: CiInstallCommand): string | undefined {
  const raw = cmd.raw;
  switch (cmd.manager) {
    case "npm":
      return /^npm\s+(install|i)\b/.test(raw)
        ? raw.replace(/^npm\s+(install|i)\b/, "npm ci")
        : undefined;
    case "pnpm":
      return /^pnpm\s+(install|i)\b/.test(raw) || /^pnpm\s*$/.test(raw)
        ? `${raw} --frozen-lockfile`
        : undefined;
    case "yarn":
      return `${raw} --immutable`;
    case "bun":
      return /^bun\s+(install|i)\b/.test(raw) ? `${raw} --frozen-lockfile` : undefined;
    case "uv":
      return /^uv\s+sync\b/.test(raw) ? `${raw} --locked` : undefined;
    default:
      return undefined; // bundler/pip need out-of-line config or hashes
  }
}

function frozenFix(cmd: CiInstallCommand): FileFix | undefined {
  if (cmd.line === undefined) {
    return undefined;
  }
  const replace = frozenReplacement(cmd);
  if (!replace || replace === cmd.raw) {
    return undefined;
  }
  return {
    kind: "replace-line",
    filePath: cmd.filePath,
    line: cmd.line,
    find: cmd.raw,
    replace,
    description: `Replace "${cmd.raw}" with "${replace}"`,
  };
}

const FROZEN_HINT: Partial<Record<PackageManager | "unknown", string>> = {
  npm: "Use `npm ci` for deterministic installs.",
  pnpm: "Use `pnpm install --frozen-lockfile`.",
  yarn: "Use `yarn install --immutable`.",
  bun: "Use `bun install --frozen-lockfile` (or `bun ci`).",
  bundler: "Use frozen/deployment Bundler behavior (e.g. `bundle config set frozen true`).",
  pip: "Pin requirements and install with `pip install --require-hashes -r requirements.txt`.",
  poetry: "Run `poetry install` with poetry.lock committed.",
  uv: "Use `uv sync --locked` (or `--frozen`).",
};

export const noMutatingInstallInCi: Rule = {
  id: "install/no-mutating-install-in-ci",
  check(ctx) {
    const findings: Finding[] = [];
    for (const cmd of ctx.state.ci.commands) {
      if (cmd.isMutatingInstall && !cmd.isFrozen) {
        findings.push({
          message: `Found "${cmd.raw}" in CI, which may mutate the lockfile or manifest.`,
          filePath: cmd.filePath,
          line: cmd.line,
          suggestion: FROZEN_HINT[cmd.manager] ?? "Use a frozen/locked install command in CI.",
          fix: frozenFix(cmd),
        });
      }
    }
    return findings;
  },
};

export const noUpdateCommandInCi: Rule = {
  id: "install/no-update-command-in-ci",
  check(ctx) {
    const findings: Finding[] = [];
    for (const cmd of ctx.state.ci.commands) {
      if (cmd.isUpdate) {
        findings.push({
          message: `Found update command "${cmd.raw}" in CI.`,
          filePath: cmd.filePath,
          line: cmd.line,
          suggestion: "Updates should be driven by Dependabot/Renovate or an explicit update job, not test CI.",
        });
      }
    }
    return findings;
  },
};

export const installRules: Rule[] = [noMutatingInstallInCi, noUpdateCommandInCi];
