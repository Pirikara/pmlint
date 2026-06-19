import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { lint, type LintResult } from "../src/core/engine.js";
import { parseComposerConstraint } from "../src/version/composer.js";
import { parseGoVersion } from "../src/version/go.js";
import { parseGradleVersion, parseMavenVersion } from "../src/version/java.js";

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

describe("version parsers (new ecosystems)", () => {
  it("treats Go versions as exact (including pseudo-versions)", () => {
    expect(parseGoVersion("v1.9.3").kind).toBe("exact");
    expect(parseGoVersion("v0.0.0-20220715151400-c0bba94af5f8").kind).toBe("exact");
  });

  it("classifies Composer constraints", () => {
    expect(parseComposerConstraint("*")).toMatchObject({ kind: "wildcard", isFloating: true });
    expect(parseComposerConstraint("dev-main")).toMatchObject({ kind: "dist-tag" });
    expect(parseComposerConstraint(">=1.0")).toMatchObject({ isUnbounded: true });
    expect(parseComposerConstraint("^3.0").kind).toBe("range");
    expect(parseComposerConstraint("7.5.0").kind).toBe("exact");
  });

  it("classifies Maven/Gradle versions", () => {
    expect(parseMavenVersion("RELEASE")).toMatchObject({ kind: "dist-tag", isFloating: true });
    expect(parseMavenVersion("[1.0,)")).toMatchObject({ isUnbounded: true });
    expect(parseMavenVersion("[1.5]").kind).toBe("exact");
    expect(parseMavenVersion("1.2.3").kind).toBe("exact");
    expect(parseGradleVersion("32.1.+")).toMatchObject({ kind: "wildcard", isFloating: true });
    expect(parseGradleVersion("latest.release")).toMatchObject({ kind: "dist-tag" });
    expect(parseGradleVersion("2.0.9").kind).toBe("exact");
  });
});

describe("ecosystem detection", () => {
  it("detects go, composer, maven, and gradle", () => {
    expect(managerOf("go-good")).toBe("go");
    expect(managerOf("php-composer-good")).toBe("composer");
    expect(managerOf("java-maven-bad")).toBe("maven");
    expect(managerOf("java-gradle-bad")).toBe("gradle");
  });
});

describe("Go", () => {
  it("requires go.sum and accepts a clean module", () => {
    expect(ruleIds("go-no-sum-bad")).toContain("lockfile/required");
    expect(ruleIds("go-good")).not.toContain("lockfile/required");
  });
});

describe("Composer", () => {
  it("flags wildcard, branch, and unbounded constraints", () => {
    const ids = ruleIds("php-composer-floating-bad");
    expect(ids).toContain("deps/no-floating-version");
    expect(ids).toContain("deps/no-dist-tag");
    expect(ids).toContain("deps/no-unbounded-range");
    expect(ids).toContain("lockfile/required");
  });

  it("ignores platform packages and accepts a clean project", () => {
    const result = lintFixture("php-composer-good");
    const ids = result.diagnostics.map((d) => d.ruleId);
    expect(ids).not.toContain("deps/no-floating-version"); // ext-json:* is skipped
    expect(ids).not.toContain("lockfile/required"); // composer.lock present
  });
});

describe("Java", () => {
  it("flags LATEST/RELEASE and unbounded Maven versions but not missing lockfile", () => {
    const ids = ruleIds("java-maven-bad");
    expect(ids).toContain("deps/no-dist-tag"); // RELEASE
    expect(ids).toContain("deps/no-unbounded-range"); // [1.0,)
    expect(ids).not.toContain("lockfile/required"); // Maven has no standard lockfile
  });

  it("flags dynamic and latest.* Gradle versions", () => {
    const ids = ruleIds("java-gradle-bad");
    expect(ids).toContain("deps/no-floating-version"); // 32.1.+
    expect(ids).toContain("deps/no-dist-tag"); // latest.release
    expect(ids).not.toContain("lockfile/required");
  });
});
