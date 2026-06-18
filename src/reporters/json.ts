import type { RuleDiagnostic } from "../model/types.js";
import type { LintResult } from "../core/engine.js";
import { VERSION } from "../version.js";

export type JsonReport = {
  version: string;
  root: string;
  summary: { errors: number; warnings: number };
  diagnostics: RuleDiagnostic[];
};

export function renderJson(result: LintResult): string {
  const report: JsonReport = {
    version: VERSION,
    root: result.root,
    summary: result.summary,
    diagnostics: result.diagnostics,
  };
  return JSON.stringify(report, null, 2);
}
