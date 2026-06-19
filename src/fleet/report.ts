import type { FleetReport, RepoScanResult } from "./types.js";

export function renderFleetJson(report: FleetReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderFleetStylish(report: FleetReport): string {
  const s = report.summary;
  const lines: string[] = [];
  lines.push("pmlint scan");
  lines.push("");
  lines.push(
    `repos: ${s.repos}   compliant: ${s.compliant}   non-compliant: ${s.nonCompliant}   failed: ${s.failed}`,
  );
  lines.push(`errors: ${s.errors}   warnings: ${s.warnings}`);

  const nonCompliant = report.repos.filter((r) => r.status === "non-compliant");
  if (nonCompliant.length > 0) {
    lines.push("");
    lines.push("Non-compliant repos:");
    for (const repo of nonCompliant) {
      lines.push(`  ${repo.target}   ${counts(repo)}`);
    }
  }

  const failed = report.repos.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    lines.push("");
    lines.push("Failed to scan:");
    for (const repo of failed) {
      lines.push(`  ${repo.target}   ${repo.error ?? "unknown error"}`);
    }
  }

  if (report.rules.length > 0) {
    lines.push("");
    lines.push("Rules (across repos):");
    for (const rule of report.rules) {
      const label = rule.repos === 1 ? "repo" : "repos";
      lines.push(
        `  ${pad(rule.severity, 5)} ${rule.ruleId}   ${rule.repos} ${label} (${rule.occurrences})`,
      );
    }
  }

  if (s.nonCompliant === 0 && s.failed === 0) {
    lines.push("");
    lines.push("All scanned repos are compliant.");
  }

  lines.push("");
  return lines.join("\n");
}

function counts(repo: RepoScanResult): string {
  return `${plural(repo.errors, "error")}, ${plural(repo.warnings, "warning")}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
