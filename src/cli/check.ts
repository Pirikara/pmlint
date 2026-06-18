import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig } from "../config/load.js";
import { lint } from "../core/engine.js";
import { applyFixes, collectFixes, planFixes } from "../fix/apply.js";
import { renderJson } from "../reporters/json.js";
import { renderStylish } from "../reporters/stylish.js";
import { renderExplain } from "./explain.js";

export type OutputFormat = "stylish" | "json";

export type CheckOptions = {
  target?: string;
  config?: string;
  format?: OutputFormat;
  color?: boolean;
  /** Ignore any repo-local pmlint.yml (audit/fleet mode). */
  noRepoConfig?: boolean;
  /** Apply safe offline fixes to the working tree. */
  fix?: boolean;
  /** Print the fix plan without writing anything. */
  fixDryRun?: boolean;
  /** Allow destructive fixes (e.g. deleting a foreign lockfile). */
  fixDestructive?: boolean;
};

export type CommandOutcome = { stdout: string; stderr?: string; exitCode: number };

function resolveRoot(target: string | undefined): string | { error: string } {
  const root = path.resolve(target ?? ".");
  if (!existsSync(root)) {
    return { error: `Path does not exist: ${root}` };
  }
  if (!statSync(root).isDirectory()) {
    return { error: `Path is not a directory: ${root}` };
  }
  return root;
}

export function runCheck(opts: CheckOptions): CommandOutcome {
  const format = opts.format ?? "stylish";
  if (format !== "stylish" && format !== "json") {
    return { stdout: "", stderr: `Unknown format: ${format} (use stylish|json)`, exitCode: 2 };
  }

  const resolved = resolveRoot(opts.target);
  if (typeof resolved !== "string") {
    return { stdout: "", stderr: resolved.error, exitCode: 2 };
  }

  let config;
  try {
    config = loadConfig(resolved, { configPath: opts.config, noRepoConfig: opts.noRepoConfig });
  } catch (err) {
    if (err instanceof ConfigError) {
      return { stdout: "", stderr: err.message, exitCode: 2 };
    }
    throw err;
  }

  // Dry run: show the fix plan, never touch disk, never fail.
  if (opts.fixDryRun) {
    const result = lint(resolved, config);
    return {
      stdout: planFixes(resolved, result.diagnostics, { destructive: opts.fixDestructive }),
      exitCode: 0,
    };
  }

  let fixNote = "";
  if (opts.fix) {
    const before = lint(resolved, config);
    const report = applyFixes(resolved, before.diagnostics, { destructive: opts.fixDestructive });
    const parts: string[] = [];
    if (report.applied.length > 0) {
      parts.push(`Applied ${report.applied.length} fix(es).`);
    }
    if (report.skippedDestructive.length > 0) {
      parts.push(
        `Skipped ${report.skippedDestructive.length} destructive fix(es) (pass --fix-destructive to apply).`,
      );
    }
    fixNote = parts.join(" ");
  }

  const result = lint(resolved, config);
  let stdout = format === "json" ? renderJson(result) : renderStylish(result, { color: opts.color });
  if (fixNote && format !== "json") {
    stdout = `${fixNote}\n\n${stdout}`;
  }

  let exitCode = 0;
  if (result.summary.errors > 0) {
    exitCode = 1;
  } else if (config.failOnWarnings && result.summary.warnings > 0) {
    exitCode = 1;
  }

  return { stdout, exitCode };
}

/** Number of auto-fixable diagnostics in the current result (for tooling). */
export function fixableCount(diagnostics: Parameters<typeof collectFixes>[0]): number {
  return collectFixes(diagnostics).length;
}

export function runExplain(opts: CheckOptions): CommandOutcome {
  const resolved = resolveRoot(opts.target);
  if (typeof resolved !== "string") {
    return { stdout: "", stderr: resolved.error, exitCode: 2 };
  }

  let config;
  try {
    config = loadConfig(resolved, { configPath: opts.config, noRepoConfig: opts.noRepoConfig });
  } catch (err) {
    if (err instanceof ConfigError) {
      return { stdout: "", stderr: err.message, exitCode: 2 };
    }
    throw err;
  }

  const result = lint(resolved, config);
  return { stdout: renderExplain(result.state), exitCode: 0 };
}
