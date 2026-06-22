import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../src/cli/check.js";
import { runScan } from "../src/cli/scan.js";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function copyFixture(name: string): string {
  const dst = mkdtempSync(path.join(tmpdir(), "pmlint-cli-"));
  cpSync(fixturePath(name), dst, { recursive: true });
  dirs.push(dst);
  return dst;
}

describe("runCheck error paths", () => {
  it("exits 2 on an unknown format", () => {
    const out = runCheck({ target: fixturePath("js-pnpm-good"), format: "xml" as never });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("Unknown format");
  });

  it("exits 2 on a nonexistent path", () => {
    const out = runCheck({ target: fixturePath("does-not-exist") });
    expect(out.exitCode).toBe(2);
  });

  it("exits 2 on a path that is a file, not a directory", () => {
    const out = runCheck({ target: fixturePath("js-pnpm-good/package.json") });
    expect(out.exitCode).toBe(2);
  });

  it("exits 2 on an invalid config", () => {
    const out = runCheck({ target: fixturePath("config-invalid") });
    expect(out.exitCode).toBe(2);
  });
});

describe("runCheck --fix / --fix-dry-run", () => {
  it("dry-run prints a plan and does not modify the tree", () => {
    const root = copyFixture("dependabot-missing");
    const out = runCheck({ target: root, fixDryRun: true });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("create");
    expect(existsSync(path.join(root, ".github/dependabot.yml"))).toBe(false);
  });

  it("--fix applies fixes and notes how many were applied", () => {
    const root = copyFixture("dependabot-missing");
    const out = runCheck({ target: root, fix: true });
    expect(out.stdout).toContain("Applied");
    expect(existsSync(path.join(root, ".github/dependabot.yml"))).toBe(true);
  });

  it("--fix reports withheld destructive fixes", () => {
    const root = copyFixture("js-foreign-lockfile-bad");
    const out = runCheck({ target: root, fix: true });
    expect(out.stdout).toContain("destructive");
    expect(existsSync(path.join(root, "package-lock.json"))).toBe(true); // not deleted
  });

  it("--fix --fix-destructive removes the foreign lockfile", () => {
    const root = copyFixture("js-foreign-lockfile-bad");
    runCheck({ target: root, fix: true, fixDestructive: true });
    expect(existsSync(path.join(root, "package-lock.json"))).toBe(false);
  });

  it("dry-run reports nothing to fix for a clean repo", () => {
    const out = runCheck({ target: fixturePath("js-pnpm-good"), fixDryRun: true });
    expect(out.stdout).toContain("No auto-fixable issues");
  });
});

describe("runScan error paths", () => {
  it("exits 2 with no targets and no org", () => {
    expect(runScan({ targets: [] }).exitCode).toBe(2);
  });

  it("exits 2 on an unknown format", () => {
    const out = runScan({ targets: [fixturePath("js-pnpm-good")], format: "yaml" as never });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("Unknown format");
  });
});
