import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/load.js";
import { lint } from "../src/core/engine.js";
import type { RuleDiagnostic } from "../src/model/types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function scratch(files: Record<string, string>): string {
  const d = mkdtempSync(path.join(tmpdir(), "pmlint-rules-"));
  dirs.push(d);
  for (const [p, c] of Object.entries(files)) {
    const fp = path.join(d, p);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, c);
  }
  return d;
}
function diags(files: Record<string, string>, rules: Record<string, "warn" | "error">): RuleDiagnostic[] {
  return lint(scratch(files), resolveConfig({ rules })).diagnostics;
}

const PKG = JSON.stringify({ name: "x", packageManager: "npm@10.8.0" });

describe("registry/no-plaintext-token patterns", () => {
  it("flags various committed token shapes, never printing the value", () => {
    const ds = diags(
      {
        "package.json": PKG,
        ".npmrc": "//registry.npmjs.org/:_authToken=npm_SECRETVALUE123\n",
      },
      { "registry/no-plaintext-token": "error" },
    );
    const d = ds.find((x) => x.ruleId === "registry/no-plaintext-token");
    expect(d).toBeDefined();
    expect(JSON.stringify(ds)).not.toContain("npm_SECRETVALUE123");
  });

  it("ignores an env-var interpolation (not a literal secret)", () => {
    const ds = diags(
      { "package.json": PKG, ".npmrc": "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n" },
      { "registry/no-plaintext-token": "error" },
    );
    expect(ds.find((x) => x.ruleId === "registry/no-plaintext-token")).toBeUndefined();
  });
});

describe("registry/no-insecure-registry", () => {
  it("flags an http registry and offers an http->https fix", () => {
    const ds = diags(
      { "package.json": PKG, ".npmrc": "registry=http://registry.example.com/\n" },
      { "registry/no-insecure-registry": "warn" },
    );
    const d = ds.find((x) => x.ruleId === "registry/no-insecure-registry");
    expect(d).toBeDefined();
    expect(d?.fix).toMatchObject({ kind: "replace-line", find: "http://", replace: "https://" });
  });

  it("flags strict-ssl=false", () => {
    const ds = diags(
      { "package.json": PKG, ".npmrc": "strict-ssl=false\n" },
      { "registry/no-insecure-registry": "warn" },
    );
    expect(ds.find((x) => x.ruleId === "registry/no-insecure-registry")).toBeDefined();
  });
});

describe("install/no-mutating-install-in-ci fixes", () => {
  const wf = (run: string) => ({
    "package.json": PKG,
    "package-lock.json": '{"lockfileVersion":3,"packages":{}}',
    ".github/workflows/ci.yml": `on: [push]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
  });
  function fixFor(run: string): string | undefined {
    const ds = diags(wf(run), { "install/no-mutating-install-in-ci": "error" });
    const d = ds.find((x) => x.ruleId === "install/no-mutating-install-in-ci");
    return d?.fix && d.fix.kind === "replace-line" ? d.fix.replace : undefined;
  }

  it("rewrites mutating installs to frozen forms per manager", () => {
    expect(fixFor("npm install")).toBe("npm ci");
    expect(fixFor("pnpm install")).toBe("pnpm install --frozen-lockfile");
    expect(fixFor("yarn install")).toBe("yarn install --immutable");
    expect(fixFor("bun install")).toBe("bun install --frozen-lockfile");
    expect(fixFor("uv sync")).toBe("uv sync --locked");
  });

  it("offers no in-place fix for bundler (needs out-of-line config)", () => {
    const ds = diags(
      {
        Gemfile: 'gem "rails"\n',
        "Gemfile.lock": "BUNDLED WITH\n   2.5.0\n",
        ".github/workflows/ci.yml":
          "on: [push]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bundle install\n",
      },
      { "install/no-mutating-install-in-ci": "error" },
    );
    const d = ds.find((x) => x.ruleId === "install/no-mutating-install-in-ci");
    expect(d).toBeDefined();
    expect(d?.fix).toBeUndefined();
  });
});

describe("adapter edge cases", () => {
  it(".NET: Directory.Packages.props and packages.config", () => {
    const propsDiags = lint(
      scratch({
        "Directory.Packages.props":
          '<Project><ItemGroup><PackageVersion Include="A" Version="1.*" /></ItemGroup></Project>',
      }),
      resolveConfig({ rules: { "deps/no-floating-version": "warn" } }),
    );
    expect(propsDiags.state.packageSurfaces[0]?.manager).toBe("nuget");
    expect(propsDiags.diagnostics.some((d) => d.ruleId === "deps/no-floating-version")).toBe(true);

    const cfgDiags = lint(
      scratch({ "packages.config": '<packages><package id="A" version="*" /></packages>' }),
      resolveConfig({ rules: { "deps/no-floating-version": "warn" } }),
    );
    expect(cfgDiags.diagnostics.some((d) => d.ruleId === "deps/no-floating-version")).toBe(true);
  });

  it("Poetry: reads group dependencies, skips the python constraint", () => {
    const result = lint(
      scratch({
        "pyproject.toml":
          '[tool.poetry]\nname="x"\nversion="0.1.0"\n[tool.poetry.dependencies]\npython="^3.11"\nrequests="*"\n[tool.poetry.group.dev.dependencies]\npytest=">=7"\n',
        "poetry.lock": "# lock\n",
      }),
      resolveConfig({ rules: { "deps/no-floating-version": "warn", "deps/no-unbounded-range": "warn" } }),
    );
    const names = result.state.packageSurfaces[0]?.dependencySpecs.map((d) => d.dependencyName);
    expect(names).toContain("requests");
    expect(names).toContain("pytest"); // group dep
    expect(names).not.toContain("python"); // interpreter constraint skipped
  });
});

describe("python adapter parsing", () => {
  it("reads PEP 621 dependencies and optional-dependencies", () => {
    const result = lint(
      scratch({
        "pyproject.toml": [
          "[project]",
          'name = "x"',
          'version = "0.1.0"',
          'dependencies = ["requests>=2", "flask==3.0.0"]',
          "[project.optional-dependencies]",
          'dev = ["pytest>=7"]',
        ].join("\n"),
        "requirements.txt": "requests==2.32.3\n",
      }),
      resolveConfig({ rules: { "deps/no-unbounded-range": "warn" } }),
    );
    const names = result.state.packageSurfaces
      .flatMap((s) => s.dependencySpecs)
      .map((d) => d.dependencyName);
    expect(names).toContain("requests");
    expect(names).toContain("flask");
    expect(names).toContain("pytest"); // optional-dependencies group
  });

  it("ignores comments, options, and editable installs in requirements.txt", () => {
    const result = lint(
      scratch({
        "requirements.txt": [
          "# a comment",
          "-r other.txt",
          "--index-url https://example.com",
          "-e .",
          "requests==2.32.3",
        ].join("\n"),
      }),
      resolveConfig({ rules: { "deps/no-floating-version": "warn" } }),
    );
    const names = result.state.packageSurfaces[0]?.dependencySpecs.map((d) => d.dependencyName) ?? [];
    expect(names).toEqual(["requests"]);
  });
});
