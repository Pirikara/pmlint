import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyFixes, planFixes } from "../src/fix/apply.js";
import { loadConfig, resolveConfig } from "../src/config/load.js";
import { lint } from "../src/core/engine.js";
import { parse as parseYaml } from "yaml";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Copy a fixture into a throwaway temp dir so fixes can mutate it safely. */
function scratchCopy(fixture: string): string {
  const src = fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url));
  const dst = mkdtempSync(path.join(tmpdir(), "pmlint-fix-"));
  cpSync(src, dst, { recursive: true });
  tempDirs.push(dst);
  return dst;
}

function ruleIds(root: string): string[] {
  return lint(root, loadConfig(root, { env: {} })).diagnostics.map((d) => d.ruleId);
}

describe("autofix", () => {
  it("rewrites a mutating CI install to a frozen one", () => {
    const root = scratchCopy("js-npm-install-bad");
    expect(ruleIds(root)).toContain("install/no-mutating-install-in-ci");

    const before = lint(root, loadConfig(root, { env: {} }));
    const report = applyFixes(root, before.diagnostics);
    expect(report.applied.length).toBeGreaterThan(0);

    const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("npm ci");
    expect(workflow).not.toMatch(/run:\s*npm install\b/);
    expect(ruleIds(root)).not.toContain("install/no-mutating-install-in-ci");
  });

  it("generates a Dependabot config covering detected roots", () => {
    const root = scratchCopy("dependabot-missing");
    const before = lint(root, loadConfig(root, { env: {} }));
    applyFixes(root, before.diagnostics);

    const configPath = path.join(root, ".github/dependabot.yml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain("package-ecosystem");
    expect(content).toContain("npm");
    expect(ruleIds(root)).not.toContain("dependabot/config-present");
  });

  it("withholds destructive fixes unless explicitly enabled", () => {
    const root = scratchCopy("js-foreign-lockfile-bad");
    const before = lint(root, loadConfig(root, { env: {} }));

    const guarded = applyFixes(root, before.diagnostics);
    expect(guarded.skippedDestructive.length).toBeGreaterThan(0);
    expect(existsSync(path.join(root, "package-lock.json"))).toBe(true);
    expect(ruleIds(root)).toContain("js/no-foreign-lockfiles");

    const forced = applyFixes(root, before.diagnostics, { destructive: true });
    expect(forced.applied.some((f) => f.kind === "delete")).toBe(true);
    expect(existsSync(path.join(root, "package-lock.json"))).toBe(false);
    expect(ruleIds(root)).not.toContain("js/no-foreign-lockfiles");
  });

  it("adds a cooldown to an existing Dependabot config (structure-preserving)", () => {
    const root = scratchCopy("dependabot-cooldown-missing");
    const config = resolveConfig({ extends: "app-strict" });

    const before = lint(root, config);
    expect(before.diagnostics.map((d) => d.ruleId)).toContain("dependabot/release-cooldown");

    const report = applyFixes(root, before.diagnostics);
    expect(report.applied.some((f) => f.kind === "rewrite")).toBe(true);

    const yml = readFileSync(path.join(root, ".github/dependabot.yml"), "utf8");
    const parsed = parseYaml(yml) as { updates: Array<{ cooldown?: { "default-days"?: number } }> };
    expect(parsed.updates[0]?.cooldown?.["default-days"]).toBe(7);
    // Existing keys are preserved by the structure-aware edit.
    expect(yml).toContain("package-ecosystem: npm");
    expect(yml).toContain("interval: weekly");

    expect(lint(root, config).diagnostics.map((d) => d.ruleId)).not.toContain(
      "dependabot/release-cooldown",
    );
  });

  it("appends a missing ecosystem entry to an existing Dependabot config", () => {
    // dependabot.yml has only a github-actions entry; the yarn (npm) root is uncovered.
    const root = scratchCopy("dependabot-yarn-uncovered");
    const config = resolveConfig({});

    const before = lint(root, config);
    const ids = before.diagnostics.map((d) => d.ruleId);
    expect(ids).toContain("dependabot/directories-cover-manifests");

    const report = applyFixes(root, before.diagnostics);
    // Coverage + cooldown both target one file; they collapse to a single rewrite.
    expect(report.applied.filter((f) => f.kind === "rewrite")).toHaveLength(1);

    const parsed = parseYaml(readFileSync(path.join(root, ".github/dependabot.yml"), "utf8")) as {
      updates: Array<{ "package-ecosystem": string; cooldown?: { "default-days"?: number } }>;
    };
    const ecos = parsed.updates.map((u) => u["package-ecosystem"]);
    expect(ecos).toContain("npm"); // appended
    expect(ecos).toContain("github-actions"); // preserved
    // Every entry ends up with a cooldown too.
    expect(parsed.updates.every((u) => u.cooldown?.["default-days"] === 7)).toBe(true);

    const after = lint(root, config).diagnostics.map((d) => d.ruleId);
    expect(after).not.toContain("dependabot/directories-cover-manifests");
    expect(after).not.toContain("dependabot/release-cooldown");
  });

  it("dry-run reports a plan without touching disk", () => {
    const root = scratchCopy("dependabot-missing");
    const result = lint(root, loadConfig(root, { env: {} }));
    const plan = planFixes(root, result.diagnostics);

    expect(plan).toContain("create");
    expect(plan).toContain(".github/dependabot.yml");
    expect(existsSync(path.join(root, ".github/dependabot.yml"))).toBe(false);
  });
});
