import { ConfigError, loadConfig, type LoadConfigOptions } from "../config/load.js";
import { lint } from "../core/engine.js";
import { VERSION } from "../version.js";
import type { FleetReport, RepoScanResult, ResolvedRepo, RuleRollup } from "./types.js";

/**
 * Run the (offline, static) engine over a set of already-resolved local
 * directories and aggregate the results into an org-level report.
 *
 * This function performs no network or filesystem cloning — resolution of
 * remote targets happens in the sources layer and is passed in here, keeping
 * aggregation pure and testable.
 */
export type ScanProgress = { done: number; total: number; result: RepoScanResult };

export function aggregate(
  repos: ResolvedRepo[],
  configOpts: LoadConfigOptions = {},
  onProgress?: (p: ScanProgress) => void,
): FleetReport {
  const results: RepoScanResult[] = [];

  repos.forEach((repo, i) => {
    let result: RepoScanResult;
    if (repo.error) {
      result = failed(repo.target, repo.root, repo.error);
    } else {
      try {
        const config = loadConfig(repo.root, configOpts);
        const lintResult = lint(repo.root, config);
        result = {
          target: repo.target,
          root: repo.root,
          status: lintResult.summary.errors > 0 ? "non-compliant" : "compliant",
          errors: lintResult.summary.errors,
          warnings: lintResult.summary.warnings,
          diagnostics: lintResult.diagnostics,
        };
      } catch (err) {
        const message = err instanceof ConfigError ? err.message : (err as Error).message;
        result = failed(repo.target, repo.root, message);
      }
    }
    results.push(result);
    onProgress?.({ done: i + 1, total: repos.length, result });
  });

  return {
    version: VERSION,
    summary: summarize(results),
    rules: rollup(results),
    repos: results,
  };
}

function failed(target: string, root: string, error: string): RepoScanResult {
  return { target, root, status: "failed", errors: 0, warnings: 0, diagnostics: [], error };
}

function summarize(results: RepoScanResult[]): FleetReport["summary"] {
  return {
    repos: results.length,
    compliant: results.filter((r) => r.status === "compliant").length,
    nonCompliant: results.filter((r) => r.status === "non-compliant").length,
    failed: results.filter((r) => r.status === "failed").length,
    errors: results.reduce((n, r) => n + r.errors, 0),
    warnings: results.reduce((n, r) => n + r.warnings, 0),
  };
}

function rollup(results: RepoScanResult[]): RuleRollup[] {
  const byRule = new Map<string, { severity: "error" | "warn"; repos: Set<string>; occurrences: number }>();
  for (const repo of results) {
    for (const diag of repo.diagnostics) {
      const entry = byRule.get(diag.ruleId) ?? {
        severity: "warn" as const,
        repos: new Set<string>(),
        occurrences: 0,
      };
      if (diag.severity === "error") {
        entry.severity = "error";
      }
      entry.repos.add(repo.root);
      entry.occurrences += 1;
      byRule.set(diag.ruleId, entry);
    }
  }

  return [...byRule.entries()]
    .map(([ruleId, e]) => ({
      ruleId,
      severity: e.severity,
      repos: e.repos.size,
      occurrences: e.occurrences,
    }))
    .sort((a, b) => {
      // Errors first, then by how widespread the rule is.
      const sev = (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1);
      if (sev !== 0) return sev;
      if (b.repos !== a.repos) return b.repos - a.repos;
      return a.ruleId.localeCompare(b.ruleId);
    });
}

/** Exit code for a fleet scan: non-zero if any repo is non-compliant or failed. */
export function fleetExitCode(report: FleetReport): number {
  return report.summary.nonCompliant > 0 || report.summary.failed > 0 ? 1 : 0;
}
