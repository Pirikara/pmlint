import { javascriptAdapter } from "../adapters/javascript.js";
import { pythonAdapter } from "../adapters/python.js";
import { rubyAdapter } from "../adapters/ruby.js";
import type { AddDiagnostic, EcosystemAdapter } from "../adapters/types.js";
import { extractCiState } from "../ci/workflows.js";
import type { ResolvedConfig } from "../config/types.js";
import { parseDependabot } from "../dependabot/parse.js";
import { discover } from "../fs/discovery.js";
import type { PackageSurface, RepositoryState, RuleDiagnostic } from "../model/types.js";
import { ALL_RULES } from "../rules/index.js";
import type { RuleContext } from "../rules/types.js";

const ADAPTERS: EcosystemAdapter[] = [javascriptAdapter, rubyAdapter, pythonAdapter];

export type LintResult = {
  root: string;
  state: RepositoryState;
  diagnostics: RuleDiagnostic[];
  summary: { errors: number; warnings: number };
};

/** Build the normalized repository state for a root, honoring enabled ecosystems. */
export function buildRepositoryState(root: string, config: ResolvedConfig): RepositoryState {
  const discovery = discover(root, config.ignore);
  const parseDiagnostics: RuleDiagnostic[] = [];
  const addDiag: AddDiagnostic = (d) => parseDiagnostics.push(d);

  const packageSurfaces: PackageSurface[] = [];
  for (const adapter of ADAPTERS) {
    if (!config.ecosystems[adapter.ecosystem]) {
      continue;
    }
    packageSurfaces.push(...adapter.buildSurfaces(discovery, addDiag));
  }

  const ci = extractCiState(discovery, addDiag);
  const dependabot = parseDependabot(discovery, addDiag);

  return {
    root,
    packageSurfaces: packageSurfaces.sort((a, b) => a.root.localeCompare(b.root)),
    ci,
    dependabot,
    parseDiagnostics,
  };
}

/** Run all enabled rules against a built state. */
export function runRules(state: RepositoryState, config: ResolvedConfig): RuleDiagnostic[] {
  const ctx: RuleContext = { state, config };
  const diagnostics: RuleDiagnostic[] = [...state.parseDiagnostics];

  for (const rule of ALL_RULES) {
    const severity = config.rules[rule.id];
    if (!severity || severity === "off") {
      continue;
    }
    for (const finding of rule.check(ctx)) {
      diagnostics.push({ ruleId: rule.id, severity, ...finding });
    }
  }

  return sortDiagnostics(diagnostics);
}

export function lint(root: string, config: ResolvedConfig): LintResult {
  const state = buildRepositoryState(root, config);
  const diagnostics = runRules(state, config);
  const summary = {
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warn").length,
  };
  return { root, state, diagnostics, summary };
}

function sortDiagnostics(diagnostics: RuleDiagnostic[]): RuleDiagnostic[] {
  const severityRank = (s: string) => (s === "error" ? 0 : 1);
  return [...diagnostics].sort((a, b) => {
    const byFile = (a.filePath ?? "").localeCompare(b.filePath ?? "");
    if (byFile !== 0) return byFile;
    const byLine = (a.line ?? 0) - (b.line ?? 0);
    if (byLine !== 0) return byLine;
    const bySev = severityRank(a.severity) - severityRank(b.severity);
    if (bySev !== 0) return bySev;
    return a.ruleId.localeCompare(b.ruleId);
  });
}
