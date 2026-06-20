import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { lint, type LintResult } from "../src/core/engine.js";
import { parseHexConstraint } from "../src/version/hex.js";

function lintFixture(name: string): LintResult {
  const root = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return lint(root, loadConfig(root, { env: {} }));
}

function ruleIds(name: string): string[] {
  return lintFixture(name).diagnostics.map((d) => d.ruleId);
}

function managerOf(name: string): string | undefined {
  return lintFixture(name).state.packageSurfaces[0]?.manager;
}

describe("Hex version parser", () => {
  it("classifies Elixir constraints", () => {
    expect(parseHexConstraint("~> 1.7.0").kind).toBe("range");
    expect(parseHexConstraint("== 1.4.0").kind).toBe("exact");
    expect(parseHexConstraint(">= 3.0.0")).toMatchObject({ isUnbounded: true });
  });
});

describe("ecosystem detection (batch 3)", () => {
  it("detects swift and hex", () => {
    expect(managerOf("swift-good")).toBe("swift");
    expect(managerOf("elixir-good")).toBe("hex");
  });
});

describe("Swift", () => {
  it("accepts from/exact/revision and flags a moving branch + missing lockfile", () => {
    expect(ruleIds("swift-good")).not.toContain("lockfile/required");
    expect(ruleIds("swift-good")).not.toContain("deps/no-unpinned-vcs-source");
    const bad = ruleIds("swift-bad");
    expect(bad).toContain("lockfile/required"); // no Package.resolved
    expect(bad).toContain("deps/no-unpinned-vcs-source"); // branch: "main"
  });
});

describe("Elixir", () => {
  it("accepts ~>/== and flags unbounded + git branch + missing lockfile", () => {
    expect(ruleIds("elixir-good")).not.toContain("lockfile/required");
    const bad = ruleIds("elixir-bad");
    expect(bad).toContain("lockfile/required"); // no mix.lock
    expect(bad).toContain("deps/no-unbounded-range"); // >= 3.0.0
    expect(bad).toContain("deps/no-unpinned-vcs-source"); // git branch: "main"
  });
});
