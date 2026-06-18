import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCheck } from "../src/cli/check.js";
import { loadConfig, resolveConfig } from "../src/config/load.js";
import { lint, type LintResult } from "../src/core/engine.js";
import { renderJson } from "../src/reporters/json.js";
import { renderStylish } from "../src/reporters/stylish.js";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function lintFixture(name: string): LintResult {
  const root = fixturePath(name);
  return lint(root, loadConfig(root));
}

function ruleIds(result: LintResult): string[] {
  return result.diagnostics.map((d) => d.ruleId);
}

describe("detection", () => {
  it("detects pnpm from packageManager, with lockfile and dependabot coverage", () => {
    const result = lintFixture("js-pnpm-good");
    const js = result.state.packageSurfaces.find((s) => s.ecosystem === "javascript");
    expect(js?.manager).toBe("pnpm");
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(0);
  });

  it("inherits the workspace manager into child packages", () => {
    const result = lintFixture("dependabot-directory-missing");
    const api = result.state.packageSurfaces.find((s) => s.root === "packages/api");
    expect(api?.manager).toBe("npm");
  });

  it("detects poetry and uv in python projects", () => {
    expect(lintFixture("python-poetry-good").state.packageSurfaces[0]?.manager).toBe("poetry");
    expect(lintFixture("python-uv-ci-bad").state.packageSurfaces[0]?.manager).toBe("uv");
  });
});

describe("rule diagnostics (recommended preset)", () => {
  it("flags foreign lockfiles", () => {
    const result = lintFixture("js-foreign-lockfile-bad");
    expect(ruleIds(result)).toContain("js/no-foreign-lockfiles");
    expect(result.summary.errors).toBeGreaterThan(0);
  });

  it("flags mutating npm install in CI", () => {
    expect(ruleIds(lintFixture("js-npm-install-bad"))).toContain(
      "install/no-mutating-install-in-ci",
    );
  });

  it("flags floating, dist-tag, unbounded, and unpinned vcs deps", () => {
    const ids = ruleIds(lintFixture("js-floating-bad"));
    expect(ids).toContain("deps/no-floating-version");
    expect(ids).toContain("deps/no-dist-tag");
    expect(ids).toContain("deps/no-unbounded-range");
    expect(ids).toContain("deps/no-unpinned-vcs-source");
  });

  it("passes a clean ruby project but flags unpinned git gems", () => {
    expect(lintFixture("ruby-good").summary.errors).toBe(0);
    expect(ruleIds(lintFixture("ruby-unpinned-git-bad"))).toContain("deps/no-unpinned-vcs-source");
  });

  it("flags floating and unbounded python requirements", () => {
    const ids = ruleIds(lintFixture("python-pip-floating-bad"));
    expect(ids).toContain("deps/no-floating-version");
    expect(ids).toContain("deps/no-unbounded-range");
  });

  it("flags uv sync without --locked in CI", () => {
    expect(ruleIds(lintFixture("python-uv-ci-bad"))).toContain(
      "install/no-mutating-install-in-ci",
    );
  });

  it("warns on missing Dependabot config without failing", () => {
    const result = lintFixture("dependabot-missing");
    expect(ruleIds(result)).toContain("dependabot/config-present");
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBeGreaterThan(0);
  });

  it("flags package roots not covered by Dependabot", () => {
    expect(ruleIds(lintFixture("dependabot-directory-missing"))).toContain(
      "dependabot/directories-cover-manifests",
    );
  });

  it("flags a committed plaintext token without leaking its value", () => {
    const result = lintFixture("registry-token-bad");
    expect(ruleIds(result)).toContain("registry/no-plaintext-token");
    const text = JSON.stringify(result.diagnostics);
    expect(text).not.toContain("npm_thisIsAFake");
  });
});

describe("config-driven behavior", () => {
  it("app-strict flags bounded-but-unpinned python requirements", () => {
    const root = fixturePath("python-bounded-range");
    const result = lint(root, resolveConfig({ extends: "app-strict" }));
    expect(ruleIds(result)).toContain("python/requirements-pinned");
  });

  it("recommended does not flag bounded ranges", () => {
    const root = fixturePath("python-bounded-range");
    const result = lint(root, resolveConfig({}));
    expect(ruleIds(result)).not.toContain("python/requirements-pinned");
  });

  it("can disable an ecosystem", () => {
    const root = fixturePath("python-pip-floating-bad");
    const result = lint(root, resolveConfig({ ecosystems: { python: { enabled: false } } }));
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("reporters", () => {
  it("renders a JSON report matching the documented shape", () => {
    const result = lintFixture("js-floating-bad");
    const report = JSON.parse(renderJson(result));
    expect(report.version).toBe("0.1.0");
    expect(report.summary.errors).toBeGreaterThan(0);
    expect(Array.isArray(report.diagnostics)).toBe(true);
    expect(report.diagnostics[0]).toHaveProperty("ruleId");
  });

  it("renders stylish output without color and without leaking ANSI", () => {
    const out = renderStylish(lintFixture("js-floating-bad"), { color: false });
    expect(out).toContain("pmlint");
    expect(out).toContain("deps/no-floating-version");
    expect(out).toContain("✖");
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\[/);
  });

  it("reports no problems for a clean repo", () => {
    const out = renderStylish(lintFixture("js-pnpm-good"), { color: false });
    expect(out).toContain("No problems found.");
  });
});

describe("CLI exit codes", () => {
  it("exits 0 for a clean project", () => {
    expect(runCheck({ target: fixturePath("js-pnpm-good") }).exitCode).toBe(0);
  });

  it("exits 1 when errors are present", () => {
    expect(runCheck({ target: fixturePath("js-floating-bad") }).exitCode).toBe(1);
  });

  it("exits 0 for warnings by default", () => {
    expect(runCheck({ target: fixturePath("dependabot-missing") }).exitCode).toBe(0);
  });

  it("exits 1 for warnings when failOnWarnings is set", () => {
    expect(runCheck({ target: fixturePath("config-fail-on-warnings") }).exitCode).toBe(1);
  });

  it("exits 2 for an invalid config", () => {
    expect(runCheck({ target: fixturePath("config-invalid") }).exitCode).toBe(2);
  });

  it("exits 2 for a nonexistent path", () => {
    expect(runCheck({ target: fixturePath("does-not-exist") }).exitCode).toBe(2);
  });

  it("supports json format", () => {
    const out = runCheck({ target: fixturePath("js-floating-bad"), format: "json" });
    expect(() => JSON.parse(out.stdout)).not.toThrow();
  });
});
