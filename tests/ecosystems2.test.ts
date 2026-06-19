import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { lint, type LintResult } from "../src/core/engine.js";
import { parseCargoVersion } from "../src/version/cargo.js";
import { parseDartConstraint } from "../src/version/dart.js";
import { parseNuGetVersion } from "../src/version/nuget.js";

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

describe("version parsers (rust/nuget/dart)", () => {
  it("treats a bare Cargo version as a caret range, = as exact", () => {
    expect(parseCargoVersion("1.0").kind).toBe("range");
    expect(parseCargoVersion("=1.4.0").kind).toBe("exact");
    expect(parseCargoVersion("*")).toMatchObject({ kind: "wildcard", isFloating: true });
    expect(parseCargoVersion(">=1.0")).toMatchObject({ isUnbounded: true });
  });

  it("treats a bare NuGet version as exact, * as floating", () => {
    expect(parseNuGetVersion("13.0.3").kind).toBe("exact");
    expect(parseNuGetVersion("1.*")).toMatchObject({ kind: "wildcard", isFloating: true });
    expect(parseNuGetVersion("[1.0,)")).toMatchObject({ isUnbounded: true });
    expect(parseNuGetVersion("[1.2.3]").kind).toBe("exact");
  });

  it("treats a bare Dart version as exact, any as wildcard", () => {
    expect(parseDartConstraint("1.18.0").kind).toBe("exact");
    expect(parseDartConstraint("^1.0.0").kind).toBe("range");
    expect(parseDartConstraint("any")).toMatchObject({ kind: "wildcard", isFloating: true });
    expect(parseDartConstraint(">=1.0.0")).toMatchObject({ isUnbounded: true });
  });
});

describe("ecosystem detection (batch 2)", () => {
  it("detects cargo, nuget, and pub", () => {
    expect(managerOf("rust-good")).toBe("cargo");
    expect(managerOf("dotnet-bad")).toBe("nuget");
    expect(managerOf("dart-good")).toBe("pub");
  });
});

describe("Rust", () => {
  it("accepts a clean crate and flags a bad one", () => {
    expect(ruleIds("rust-good")).not.toContain("lockfile/required");
    const bad = ruleIds("rust-bad");
    expect(bad).toContain("lockfile/required"); // no Cargo.lock
    expect(bad).toContain("deps/no-floating-version"); // *
    expect(bad).toContain("deps/no-unbounded-range"); // >=1.0
    expect(bad).toContain("deps/no-unpinned-vcs-source"); // git branch
  });
});

describe(".NET", () => {
  it("flags floating/unbounded NuGet versions but not missing lockfile", () => {
    const ids = ruleIds("dotnet-bad");
    expect(ids).toContain("deps/no-floating-version"); // 1.*
    expect(ids).toContain("deps/no-unbounded-range"); // [1.0,)
    expect(ids).not.toContain("lockfile/required"); // NuGet locking is opt-in
  });
});

describe("Dart", () => {
  it("accepts a clean package and flags a bad one", () => {
    expect(ruleIds("dart-good")).not.toContain("lockfile/required");
    const bad = ruleIds("dart-bad");
    expect(bad).toContain("lockfile/required"); // no pubspec.lock
    expect(bad).toContain("deps/no-floating-version"); // any
    expect(bad).toContain("deps/no-unbounded-range"); // >=1.0.0
    expect(bad).toContain("deps/no-unpinned-vcs-source"); // git ref: main
  });
});
