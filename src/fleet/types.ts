import type { RuleDiagnostic } from "../model/types.js";

export type RepoStatus = "compliant" | "non-compliant" | "failed";

export type RepoScanResult = {
  /** The target as supplied (local path, URL, or owner/repo). */
  target: string;
  /** The local directory that was scanned. */
  root: string;
  status: RepoStatus;
  errors: number;
  warnings: number;
  diagnostics: RuleDiagnostic[];
  /** Set when the repo could not be scanned (clone/config failure). */
  error?: string;
};

export type RuleRollup = {
  ruleId: string;
  severity: "error" | "warn";
  /** Number of distinct repos where the rule fired. */
  repos: number;
  /** Total occurrences across all repos. */
  occurrences: number;
};

export type FleetReport = {
  version: string;
  summary: {
    repos: number;
    compliant: number;
    nonCompliant: number;
    failed: number;
    errors: number;
    warnings: number;
  };
  rules: RuleRollup[];
  repos: RepoScanResult[];
};

/** A target resolved to a local directory (or an error if resolution failed). */
export type ResolvedRepo = {
  target: string;
  root: string;
  error?: string;
};
