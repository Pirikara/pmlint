import type { OutputFormat, CommandOutcome } from "./check.js";
import { aggregate, fleetExitCode } from "../fleet/scan.js";
import { renderFleetJson, renderFleetStylish } from "../fleet/report.js";
import { resolveTargets, SourceError } from "../fleet/sources.js";
import { createProgressReporter } from "./progress.js";

export type ScanOptions = {
  targets: string[];
  org?: string;
  /** Cap repos from --org. 0 or undefined = all (paginated). */
  limit?: number;
  config?: string;
  noRepoConfig?: boolean;
  format?: OutputFormat;
  keepClones?: boolean;
  /** Per-repo clone timeout in seconds. */
  cloneTimeoutSeconds?: number;
  /** Show progress on stderr (default true when stderr is a TTY). */
  progress?: boolean;
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

  const progress = createProgressReporter(opts.progress);

  let resolved;
  try {
    resolved = resolveTargets(opts.targets, {
      org: opts.org,
      limit: opts.limit,
      keepClones: opts.keepClones,
      cloneTimeoutMs:
        opts.cloneTimeoutSeconds && opts.cloneTimeoutSeconds > 0
          ? opts.cloneTimeoutSeconds * 1000
          : undefined,
      onProgress: (p) => {
        if (p.phase === "enumerating") {
          progress.line(`Enumerating repos in org "${p.org}"…`);
        } else {
          const verb = p.cloned ? "cloned" : "resolved";
          progress.update(`[${p.done}/${p.total}] ${verb} ${p.spec}`);
        }
      },
    });
  } catch (err) {
    progress.done();
    if (err instanceof SourceError) {
      return { stdout: "", stderr: err.message, exitCode: 2 };
    }
    throw err;
  }

  try {
    const report = aggregate(
      resolved.repos,
      { configPath: opts.config, noRepoConfig: opts.noRepoConfig },
      (p) => {
        const r = p.result;
        const tag =
          r.status === "failed"
            ? "failed"
            : r.status === "non-compliant"
              ? `${r.errors} error${r.errors === 1 ? "" : "s"}`
              : "ok";
        progress.update(`[${p.done}/${p.total}] scanned ${r.target} (${tag})`);
      },
    );
    progress.done();
    const stdout = format === "json" ? renderFleetJson(report) : renderFleetStylish(report);
    return { stdout, exitCode: fleetExitCode(report) };
  } finally {
    for (const cleanup of resolved.cleanups) {
      cleanup();
    }
  }
}
