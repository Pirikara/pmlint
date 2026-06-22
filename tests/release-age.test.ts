import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/load.js";
import { lint, type LintResult } from "../src/core/engine.js";
import { parseExcludeNewer } from "../src/rules/release-age.js";

function lintFixture(name: string, threshold = 0): LintResult {
  const root = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const config = resolveConfig({
    rules: {
      "js/release-age-gate": "warn",
      "ruby/release-age-gate": "warn",
      "python/release-age-gate": "warn",
    },
    minReleaseAgeSeconds: threshold,
  });
  return lint(root, config);
}

function gate(result: LintResult) {
  return result.diagnostics.find((d) => d.ruleId.endsWith("/release-age-gate"));
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

describe("parseExcludeNewer (uv)", () => {
  it("parses friendly and ISO durations to seconds", () => {
    expect(parseExcludeNewer("7 days")).toBe(7 * 86_400);
    expect(parseExcludeNewer("1 week")).toBe(7 * 86_400);
    expect(parseExcludeNewer("P7D")).toBe(7 * 86_400);
    expect(parseExcludeNewer("24 hours")).toBe(24 * 3600);
  });

  it("treats an absolute timestamp as present-but-unmeasurable", () => {
    expect(parseExcludeNewer("2006-12-02T02:07:43Z")).toBe("present");
  });
});

describe("release-age-gate (ruby / python)", () => {
  it("accepts a Bundler cooldown in .bundle/config", () => {
    const result = lintFixture("ruby-cooldown-good", 7 * 86_400);
    expect(gate(result)).toBeUndefined();
  });

  it("flags a Ruby project with no Bundler cooldown", () => {
    const result = lintFixture("ruby-good");
    const g = result.diagnostics.find((d) => d.ruleId === "ruby/release-age-gate");
    expect(g).toBeDefined();
    expect(g?.suggestion).toContain("cooldown");
  });

  it("accepts Poetry [solver] min-release-age in poetry.toml", () => {
    const result = lintFixture("python-poetry-cooldown-good", 7 * 86_400);
    expect(result.diagnostics.find((d) => d.ruleId === "python/release-age-gate")).toBeUndefined();
  });

  it("accepts uv exclude-newer = '7 days' in pyproject.toml", () => {
    const result = lintFixture("python-uv-cooldown-good", 7 * 86_400);
    expect(result.diagnostics.find((d) => d.ruleId === "python/release-age-gate")).toBeUndefined();
  });

  it("flags a uv project with no exclude-newer, pointing at pyproject.toml", () => {
    const result = lintFixture("python-uv-ci-bad");
    const g = result.diagnostics.find((d) => d.ruleId === "python/release-age-gate");
    expect(g).toBeDefined();
    expect(g?.filePath?.endsWith("pyproject.toml")).toBe(true);
  });

  it("does not flag pip projects (no native gate)", () => {
    const result = lintFixture("python-pip-floating-bad");
    expect(result.diagnostics.find((d) => d.ruleId === "python/release-age-gate")).toBeUndefined();
  });
});
