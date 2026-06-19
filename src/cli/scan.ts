import type { OutputFormat, CommandOutcome } from "./check.js";
import { aggregate, fleetExitCode } from "../fleet/scan.js";
import { renderFleetJson, renderFleetStylish } from "../fleet/report.js";
import { resolveTargets, SourceError } from "../fleet/sources.js";

export type ScanOptions = {
  targets: string[];
  org?: string;
  limit?: number;
  config?: string;
  noRepoConfig?: boolean;
  format?: OutputFormat;
  keepClones?: boolean;
};

/**
 * Fleet/org scan: resolve targets to local dirs (cloning remotes), run the
 * static engine on each, and emit an aggregated report.
 */
export function runScan(opts: ScanOptions): CommandOutcome {
  const format = opts.format ?? "stylish";
  if (format !== "stylish" && format !== "json") {
    return { stdout: "", stderr: `Unknown format: ${format} (use stylish|json)`, exitCode: 2 };
  }
  if (opts.targets.length === 0 && !opts.org) {
    return {
      stdout: "",
      stderr: "No targets. Pass repo paths/URLs/owner-repo specs, or --org <name>.",
      exitCode: 2,
    };
  }

  let resolved;
  try {
    resolved = resolveTargets(opts.targets, {
      org: opts.org,
      limit: opts.limit,
      keepClones: opts.keepClones,
    });
  } catch (err) {
    if (err instanceof SourceError) {
      return { stdout: "", stderr: err.message, exitCode: 2 };
    }
    throw err;
  }

  try {
    const report = aggregate(resolved.repos, {
      configPath: opts.config,
      noRepoConfig: opts.noRepoConfig,
    });
    const stdout = format === "json" ? renderFleetJson(report) : renderFleetStylish(report);
    return { stdout, exitCode: fleetExitCode(report) };
  } finally {
    for (const cleanup of resolved.cleanups) {
      cleanup();
    }
  }
}
