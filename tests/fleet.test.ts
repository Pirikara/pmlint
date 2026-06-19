import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runScan } from "../src/cli/scan.js";
import { renderFleetJson } from "../src/fleet/report.js";
import { aggregate } from "../src/fleet/scan.js";
import type { ResolvedRepo } from "../src/fleet/types.js";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe("fleet aggregate", () => {
  const repos: ResolvedRepo[] = [
    { target: "good", root: fixturePath("js-pnpm-good") },
    { target: "foreign", root: fixturePath("js-foreign-lockfile-bad") },
    { target: "deps-warn", root: fixturePath("dependabot-missing") },
    { target: "org/broken", root: "/does/not/exist", error: "clone failed" },
  ];

  it("classifies repos and totals the summary", () => {
    const report = aggregate(repos, { env: {} });
    expect(report.summary.repos).toBe(4);
    expect(report.summary.compliant).toBe(2); // js-pnpm-good + dependabot-missing (warnings only)
    expect(report.summary.nonCompliant).toBe(1); // js-foreign-lockfile-bad
    expect(report.summary.failed).toBe(1);
    expect(report.summary.errors).toBeGreaterThan(0);
  });

  it("rolls up rules across repos with errors first", () => {
    const report = aggregate(repos, { env: {} });
    const foreign = report.rules.find((r) => r.ruleId === "js/no-foreign-lockfiles");
    expect(foreign?.severity).toBe("error");
    expect(foreign?.repos).toBe(1);
    // Error-severity rules sort ahead of warnings.
    expect(report.rules[0]?.severity).toBe("error");
  });

  it("marks a pre-resolved error as failed without scanning", () => {
    const report = aggregate(repos, { env: {} });
    const broken = report.repos.find((r) => r.target === "org/broken");
    expect(broken?.status).toBe("failed");
    expect(broken?.error).toContain("clone failed");
  });

  it("produces a JSON report with the documented shape", () => {
    const report = JSON.parse(renderFleetJson(aggregate(repos, { env: {} })));
    expect(report.version).toBe("0.1.0");
    expect(report.summary).toHaveProperty("nonCompliant");
    expect(Array.isArray(report.rules)).toBe(true);
    expect(Array.isArray(report.repos)).toBe(true);
  });
});

describe("runScan (local targets)", () => {
  it("exits 1 when any repo is non-compliant", () => {
    const outcome = runScan({
      targets: [fixturePath("js-pnpm-good"), fixturePath("js-foreign-lockfile-bad")],
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toContain("non-compliant");
  });

  it("exits 0 when all scanned repos are compliant", () => {
    const outcome = runScan({ targets: [fixturePath("js-pnpm-good")] });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("compliant");
  });

  it("supports json output", () => {
    const outcome = runScan({ targets: [fixturePath("js-pnpm-good")], format: "json" });
    expect(() => JSON.parse(outcome.stdout)).not.toThrow();
  });

  it("treats an unresolvable absolute path as failed (no network)", () => {
    const outcome = runScan({ targets: ["/does/not/exist/repo"] });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stdout).toContain("Failed to scan");
  });

  it("errors (exit 2) when given no targets", () => {
    expect(runScan({ targets: [] }).exitCode).toBe(2);
  });
});
