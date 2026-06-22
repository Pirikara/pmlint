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
  const d = mkdtempSync(path.join(tmpdir(), "pmlint-js-"));
  dirs.push(d);
  for (const [p, c] of Object.entries(files)) {
    const fp = path.join(d, p);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, c);
  }
  return d;
}
function fires(
  ruleId: string,
  files: Record<string, string>,
  opts: { severity?: Severity; threshold?: number } = {},
): boolean {
  const config = resolveConfig({
    rules: { [ruleId]: opts.severity ?? "warn" },
    minReleaseAgeSeconds: opts.threshold ?? 0,
  });
  return lint(scratch(files), config).diagnostics.some((d) => d.ruleId === ruleId);
}

const pkg = (manager: string) => JSON.stringify({ name: "x", packageManager: manager });

describe("js/release-age-gate per manager", () => {
  it("pnpm: minimumReleaseAge in pnpm-workspace.yaml (minutes)", () => {
    const files = {
      "package.json": pkg("pnpm@10.16.1"),
      "pnpm-lock.yaml": 'lockfileVersion: "9.0"\n',
      "pnpm-workspace.yaml": "minimumReleaseAge: 10080\n",
    };
    expect(fires("js/release-age-gate", files, { threshold: 604_800 })).toBe(false);
    // Below the threshold (1 minute << 7 days) -> fires.
    expect(
      fires(
        "js/release-age-gate",
        { ...files, "pnpm-workspace.yaml": "minimumReleaseAge: 1\n" },
        { threshold: 604_800 },
      ),
    ).toBe(true);
  });

  it("yarn: npmMinimalAgeGate in .yarnrc.yml (minutes)", () => {
    expect(
      fires(
        "js/release-age-gate",
        {
          "package.json": pkg("yarn@4.1.0"),
          "yarn.lock": "__metadata:\n  version: 8\n",
          ".yarnrc.yml": "npmMinimalAgeGate: 10080\n",
        },
        { threshold: 604_800 },
      ),
    ).toBe(false);
  });

  it("bun: install.minimumReleaseAge in bunfig.toml (seconds)", () => {
    expect(
      fires(
        "js/release-age-gate",
        {
          "package.json": pkg("bun@1.1.0"),
          "bun.lock": "{}\n",
          "bunfig.toml": "[install]\nminimumReleaseAge = 604800\n",
        },
        { threshold: 604_800 },
      ),
    ).toBe(false);
  });
});

describe("js/save-exact-configured per manager", () => {
  it("npm/pnpm: save-exact or save-prefix in .npmrc", () => {
    const base = { "package.json": pkg("npm@10.8.0"), "package-lock.json": "{}" };
    expect(fires("js/save-exact-configured", { ...base, ".npmrc": "save-exact=true\n" })).toBe(false);
    // `save-prefix=` (empty) is the canonical way to drop the range prefix.
    expect(fires("js/save-exact-configured", { ...base, ".npmrc": "save-prefix=\n" })).toBe(false);
    expect(fires("js/save-exact-configured", { ...base, ".npmrc": "registry=https://r/\n" })).toBe(true);
  });

  it("yarn: defaultSemverRangePrefix in .yarnrc.yml", () => {
    const base = { "package.json": pkg("yarn@4.1.0"), "yarn.lock": "__metadata:\n  version: 8\n" };
    expect(
      fires("js/save-exact-configured", { ...base, ".yarnrc.yml": 'defaultSemverRangePrefix: ""\n' }),
    ).toBe(false);
    expect(fires("js/save-exact-configured", base)).toBe(true);
  });

  it("bun: install.exact in bunfig.toml", () => {
    const base = { "package.json": pkg("bun@1.1.0"), "bun.lock": "{}\n" };
    expect(
      fires("js/save-exact-configured", { ...base, "bunfig.toml": "[install]\nexact = true\n" }),
    ).toBe(false);
    expect(fires("js/save-exact-configured", base)).toBe(true);
  });
});

describe("js/single-manager", () => {
  it("flags a config file that disagrees with the declared manager", () => {
    // Declares pnpm, but ships a yarn config.
    expect(
      fires("js/single-manager", {
        "package.json": pkg("pnpm@10.16.1"),
        "pnpm-lock.yaml": 'lockfileVersion: "9.0"\n',
        ".yarnrc.yml": "nodeLinker: node-modules\n",
      }),
    ).toBe(true);
  });
});
