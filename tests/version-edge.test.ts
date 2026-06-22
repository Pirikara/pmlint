import { describe, expect, it } from "vitest";
import { parseCargoValue } from "../src/adapters/rust.js";
import { parseGoMod } from "../src/adapters/go.js";
import { parsePom, parseGradle } from "../src/adapters/java.js";
import { parsePackageSwift } from "../src/adapters/swift.js";
import { parseMixExs } from "../src/adapters/elixir.js";
import { parseGradleVersion, parseMavenVersion } from "../src/version/java.js";
import { parseNuGetVersion } from "../src/version/nuget.js";
import { parseComposerConstraint } from "../src/version/composer.js";

describe("Cargo value parser (table forms)", () => {
  it("handles git rev/tag/branch, path, and workspace", () => {
    expect(parseCargoValue({ git: "https://x/y", rev: "abc" })).toMatchObject({ isPinnedVcs: true });
    expect(parseCargoValue({ git: "https://x/y", branch: "main" })).toMatchObject({ isPinnedVcs: false });
    expect(parseCargoValue({ path: "../local" }).kind).toBe("path");
    expect(parseCargoValue({ workspace: true }).kind).toBe("unknown");
    expect(parseCargoValue({ version: "1.0" }).kind).toBe("range");
  });
});

describe("go.mod parser", () => {
  it("reads both block and single require forms", () => {
    const specs = parseGoMod(
      "module x\n\nrequire (\n\tgithub.com/a/b v1.2.3\n\tgithub.com/c/d v0.0.0-20220715151400-c0bba94af5f8 // indirect\n)\n\nrequire github.com/e/f v1.0.0\n",
      "go.mod",
    );
    const names = specs.map((s) => s.dependencyName);
    expect(names).toContain("github.com/a/b");
    expect(names).toContain("github.com/e/f");
    expect(specs.every((s) => s.parsed.kind === "exact")).toBe(true);
  });
});

describe("Maven/Gradle version parser edge cases", () => {
  it("Maven: property, LATEST, bracket forms", () => {
    expect(parseMavenVersion("${junit.version}").kind).toBe("unknown");
    expect(parseMavenVersion("LATEST").kind).toBe("dist-tag");
    expect(parseMavenVersion("[1.5]").kind).toBe("exact");
    expect(parseMavenVersion("[1.0,2.0)").kind).toBe("range");
  });

  it("Gradle: dynamic +, latest.*, strict !!", () => {
    expect(parseGradleVersion("1.+")).toMatchObject({ isFloating: true });
    expect(parseGradleVersion("latest.release").kind).toBe("dist-tag");
    expect(parseGradleVersion("1.2.3!!").kind).toBe("exact");
    expect(parseGradleVersion("$ver").kind).toBe("unknown");
  });

  it("pom.xml resolves a simple ${property}", () => {
    const pom =
      '<project><properties><junit.version>5.10.0</junit.version></properties>' +
      '<dependencies><dependency><groupId>org.junit</groupId>' +
      "<artifactId>junit</artifactId><version>${junit.version}</version></dependency></dependencies></project>";
    const specs = parsePom(pom, "pom.xml");
    expect(specs[0]?.dependencyName).toBe("org.junit:junit");
    expect(specs[0]?.parsed.kind).toBe("exact");
  });

  it("build.gradle reads string-notation coordinates", () => {
    const specs = parseGradle("dependencies { implementation 'g:a:1.2.3' }", "build.gradle");
    expect(specs[0]?.dependencyName).toBe("g:a");
    expect(specs[0]?.parsed.kind).toBe("exact");
  });
});

describe("NuGet / Composer parsers", () => {
  it("NuGet: bracket exact/range/unbounded and wildcard", () => {
    expect(parseNuGetVersion("[1.2.3]").kind).toBe("exact");
    expect(parseNuGetVersion("[1.0,)")).toMatchObject({ isUnbounded: true });
    expect(parseNuGetVersion("1.*")).toMatchObject({ isFloating: true });
    expect(parseNuGetVersion("")).toMatchObject({ kind: "empty" });
  });

  it("Composer: stability flags, ||, and 1.2.* wildcard", () => {
    expect(parseComposerConstraint("^1.0@dev").kind).toBe("range");
    expect(parseComposerConstraint("1.0.* || 2.0.*").kind).toBe("range");
    expect(parseComposerConstraint("1.x-dev").kind).toBe("dist-tag");
  });
});

describe("Package.swift / mix.exs parsers", () => {
  it("Swift: from/exact/revision/branch/path", () => {
    const specs = parsePackageSwift(
      [
        '.package(url: "https://github.com/a/b.git", from: "1.0.0"),',
        '.package(url: "https://github.com/c/d.git", branch: "main"),',
        '.package(url: "https://github.com/e/f.git", revision: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"),',
        '.package(path: "../local"),',
      ].join("\n"),
      "Package.swift",
    );
    const byName = Object.fromEntries(specs.map((s) => [s.dependencyName, s.parsed]));
    expect(byName["b"].kind).toBe("range");
    expect(byName["d"]).toMatchObject({ kind: "vcs", isPinnedVcs: false });
    expect(byName["f"]).toMatchObject({ kind: "vcs", isPinnedVcs: true });
    expect(byName["../local"].kind).toBe("path");
  });

  it("Elixir: version, git tag/branch, path", () => {
    const specs = parseMixExs(
      [
        "defp deps do",
        "  [",
        '    {:phoenix, "~> 1.7"},',
        '    {:a, git: "https://x/y.git", tag: "v1.0"},',
        '    {:b, git: "https://x/z.git", branch: "main"},',
        '    {:c, path: "../c"}',
        "  ]",
        "end",
      ].join("\n"),
      "mix.exs",
    );
    const byName = Object.fromEntries(specs.map((s) => [s.dependencyName, s.parsed]));
    expect(byName["phoenix"].kind).toBe("range");
    expect(byName["a"]).toMatchObject({ kind: "vcs", isPinnedVcs: true });
    expect(byName["b"]).toMatchObject({ kind: "vcs", isPinnedVcs: false });
    expect(byName["c"].kind).toBe("path");
  });
});
