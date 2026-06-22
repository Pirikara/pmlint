import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/load.js";
import { lint } from "../src/core/engine.js";
import type { Severity } from "../src/model/types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(files: Record<string, string>): string {
  const d = mkdtempSync(path.join(tmpdir(), "pmlint-eco-"));
  dirs.push(d);
  for (const [p, c] of Object.entries(files)) {
    const fp = path.join(d, p);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, c);
  }
  return d;
}

/** Lint a scratch repo with only the given rule enabled. */
function fires(ruleId: string, files: Record<string, string>, severity: Severity = "warn"): boolean {
  const root = scratch(files);
  const config = resolveConfig({ rules: { [ruleId]: severity } });
  return lint(root, config).diagnostics.some((d) => d.ruleId === ruleId);
}

const GEMFILE_LOCK = "GEM\n  specs:\n    rails (7.1.0)\n\nBUNDLED WITH\n   2.5.0\n";

describe("ruby ecosystem rules", () => {
  it("ruby/gemfile-lock-required: fires without a lock, not with one", () => {
    expect(fires("ruby/gemfile-lock-required", { Gemfile: 'gem "rails", "~> 7.1"\n' })).toBe(true);
    expect(
      fires("ruby/gemfile-lock-required", {
        Gemfile: 'gem "rails", "~> 7.1"\n',
        "Gemfile.lock": GEMFILE_LOCK,
      }),
    ).toBe(false);
  });

  it("ruby/frozen-install-in-ci: fires on a non-frozen bundle install", () => {
    const wf = (run: string) => ({
      Gemfile: 'gem "rails", "~> 7.1"\n',
      "Gemfile.lock": GEMFILE_LOCK,
      ".github/workflows/ci.yml": `on: [push]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
    expect(fires("ruby/frozen-install-in-ci", wf("bundle install"))).toBe(true);
    expect(fires("ruby/frozen-install-in-ci", wf("bundle install --deployment"))).toBe(false);
  });

  it("ruby/no-unpinned-git-source: branch fires, tag does not", () => {
    const gem = (src: string) => ({
      Gemfile: `gem "ex", ${src}\n`,
      "Gemfile.lock": GEMFILE_LOCK,
    });
    expect(
      fires("ruby/no-unpinned-git-source", gem('git: "https://x/y.git", branch: "main"')),
    ).toBe(true);
    expect(fires("ruby/no-unpinned-git-source", gem('git: "https://x/y.git", tag: "v1.2.3"'))).toBe(
      false,
    );
  });

  it("ruby/no-unbounded-gem-version: open lower bound fires, pessimistic does not", () => {
    const gem = (spec: string) => ({
      Gemfile: `gem "rails", "${spec}"\n`,
      "Gemfile.lock": GEMFILE_LOCK,
    });
    expect(fires("ruby/no-unbounded-gem-version", gem(">= 7.0"))).toBe(true);
    expect(fires("ruby/no-unbounded-gem-version", gem("~> 7.1.0"))).toBe(false);
  });
});

describe("python ecosystem rules", () => {
  const POETRY = '[tool.poetry]\nname = "x"\nversion = "0.1.0"\n[tool.poetry.dependencies]\npython = "^3.11"\nrequests = "2.32.3"\n';

  it("poetry/lockfile-required + python/lockfile-required: fire without poetry.lock", () => {
    expect(fires("poetry/lockfile-required", { "pyproject.toml": POETRY })).toBe(true);
    expect(fires("python/lockfile-required", { "pyproject.toml": POETRY })).toBe(true);
    expect(
      fires("poetry/lockfile-required", { "pyproject.toml": POETRY, "poetry.lock": "# lock\n" }),
    ).toBe(false);
  });

  it("python/require-hashes: fires when requirements.txt has no --hash", () => {
    expect(fires("python/require-hashes", { "requirements.txt": "requests==2.32.3\n" })).toBe(true);
    expect(
      fires("python/require-hashes", {
        "requirements.txt": "requests==2.32.3 --hash=sha256:abc\n",
      }),
    ).toBe(false);
  });

  it("python/no-unpinned-vcs-requirement: fires on an unpinned VCS requirement", () => {
    expect(
      fires("python/no-unpinned-vcs-requirement", {
        "requirements.txt": "pkg @ git+https://github.com/x/y.git\n",
      }),
    ).toBe(true);
    expect(
      fires("python/no-unpinned-vcs-requirement", {
        "requirements.txt": "pkg @ git+https://github.com/x/y.git@v1.2.3\n",
      }),
    ).toBe(false);
  });

  it("uv/locked-in-ci: fires on `uv sync` without --locked", () => {
    const wf = (run: string) => ({
      "pyproject.toml": '[project]\nname="x"\nversion="0.1.0"\ndependencies=[]\n[tool.uv]\n',
      "uv.lock": "version = 1\n",
      ".github/workflows/ci.yml": `on: [push]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`,
    });
    expect(fires("uv/locked-in-ci", wf("uv sync"))).toBe(true);
    expect(fires("uv/locked-in-ci", wf("uv sync --locked"))).toBe(false);
  });
});
