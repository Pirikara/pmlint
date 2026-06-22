import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/load.js";
import { lint, type LintResult } from "../src/core/engine.js";

function lintFixture(name: string, threshold = 0): LintResult {
  const root = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const config = resolveConfig({
    rules: { "js/release-age-gate": "warn" },
    minReleaseAgeSeconds: threshold,
  });
  return lint(root, config);
}

function gate(result: LintResult) {
  return result.diagnostics.find((d) => d.ruleId === "js/release-age-gate");
}

describe("js/release-age-gate (npm)", () => {
  it("accepts npm min-release-age in .npmrc (interpreted as days)", () => {
    // min-release-age=7 (days) = 604800s, which meets a 7-day threshold.
    const result = lintFixture("npm-release-age-good", 604_800);
    expect(gate(result)).toBeUndefined();
  });

  it("treats the npm value as days, not seconds (7 days >= 6-day threshold)", () => {
    const result = lintFixture("npm-release-age-good", 6 * 86_400);
    expect(gate(result)).toBeUndefined();
  });

  it("flags a missing gate and points at the config file, not package.json", () => {
    // js-npm-install-bad has no .npmrc.
    const result = lintFixture("js-npm-install-bad");
    const g = gate(result);
    expect(g).toBeDefined();
    expect(g?.filePath).toBe(".npmrc"); // not package.json
    expect(g?.suggestion).toContain("min-release-age");
    expect(g?.suggestion).toContain("days");
  });

  it("points the diagnostic at the existing .npmrc when one is present but lacks the key", () => {
    // registry-token-bad has a .npmrc without min-release-age.
    const result = lintFixture("registry-token-bad");
    const g = gate(result);
    expect(g).toBeDefined();
    expect(g?.filePath?.endsWith(".npmrc")).toBe(true);
  });
});
