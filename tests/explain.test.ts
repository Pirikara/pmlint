import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runExplain } from "../src/cli/check.js";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe("runExplain", () => {
  it("reports detected surfaces with manager/manifest/lockfile/dependabot/ci", () => {
    const out = runExplain({ target: fixturePath("js-pnpm-good") });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Detected ecosystems:");
    expect(out.stdout).toContain("javascript");
    expect(out.stdout).toContain("manager: pnpm");
    expect(out.stdout).toContain("lockfile: pnpm-lock.yaml");
    expect(out.stdout).toContain("dependabot: covered");
    expect(out.stdout).toContain("ci install: frozen");
  });

  it("shows 'missing' lockfile and 'not covered' dependabot where applicable", () => {
    const out = runExplain({ target: fixturePath("dependabot-missing") });
    expect(out.stdout).toContain("dependabot: missing");
  });

  it("reports no package roots for a non-package repo", () => {
    const out = runExplain({ target: fixturePath("policy-app-strict") });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("No package roots detected.");
  });

  it("exits 2 for a path that does not exist", () => {
    const out = runExplain({ target: fixturePath("nope-does-not-exist") });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toBeDefined();
  });

  it("exits 2 for an invalid config", () => {
    const out = runExplain({ target: fixturePath("config-invalid") });
    expect(out.exitCode).toBe(2);
  });
});
