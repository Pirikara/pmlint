import type { RuleDiagnostic } from "../model/types.js";
import type { LintResult } from "../core/engine.js";

const COLORS = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  red: "[31m",
  yellow: "[33m",
  green: "[32m",
  cyan: "[36m",
};

export type StylishOptions = { color?: boolean };

export function renderStylish(result: LintResult, options: StylishOptions = {}): string {
  const color = options.color ?? false;
  const c = (code: keyof typeof COLORS, text: string) =>
    color ? `${COLORS[code]}${text}${COLORS.reset}` : text;

  const lines: string[] = [];
  lines.push(c("bold", "pmlint"));
  lines.push("");

  if (result.diagnostics.length === 0) {
    lines.push(c("green", "No problems found."));
    lines.push("");
    return lines.join("\n");
  }

  for (const diag of result.diagnostics) {
    const sevColor = diag.severity === "error" ? "red" : "yellow";
    lines.push(`${c(sevColor, diag.severity)} ${c("cyan", diag.ruleId)}`);
    if (diag.filePath) {
      const loc = diag.line ? `${diag.filePath}:${diag.line}` : diag.filePath;
      lines.push(`  ${c("dim", loc)}`);
    }
    lines.push(`  ${diag.message}`);
    if (diag.suggestion) {
      lines.push(`  ${c("dim", diag.suggestion)}`);
    }
    lines.push("");
  }

  lines.push(summaryLine(result.summary, c));
  lines.push("");
  return lines.join("\n");
}

function summaryLine(
  summary: { errors: number; warnings: number },
  c: (code: keyof typeof COLORS, text: string) => string,
): string {
  const parts: string[] = [];
  parts.push(plural(summary.errors, "error"));
  parts.push(plural(summary.warnings, "warning"));
  const text = `✖ ${parts.join(", ")}`;
  return c(summary.errors > 0 ? "red" : "yellow", text);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
