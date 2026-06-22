import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { orgReposCommand, resolveTargets } from "../src/fleet/sources.js";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe("orgReposCommand", () => {
  it("uses `gh repo list --limit N` for a bounded limit", () => {
    const args = orgReposCommand("acme", 250);
    expect(args.slice(0, 3)).toEqual(["repo", "list", "acme"]);
    expect(args).toContain("--limit");
    expect(args[args.indexOf("--limit") + 1]).toBe("250");
    expect(args).toContain("--no-archived");
  });

  it("uses `gh api --paginate` (no cap) when limit <= 0", () => {
    const args = orgReposCommand("acme", 0);
    expect(args[0]).toBe("api");
    expect(args).toContain("--paginate");
    expect(args.some((a) => a.startsWith("orgs/acme/repos"))).toBe(true);
    // Excludes archived repos in the jq filter.
    expect(args.join(" ")).toContain("archived == false");
  });

  it("requests 100 per page when paginating", () => {
    const args = orgReposCommand("acme", -1);
    expect(args.some((a) => a.includes("per_page=100"))).toBe(true);
  });
});

describe("resolveTargets (no network)", () => {
  it("resolves a local directory to its absolute path without cloning", () => {
    const { repos, cleanups } = resolveTargets([fixturePath("js-pnpm-good")]);
    expect(repos).toHaveLength(1);
    expect(repos[0]?.root).toBe(path.resolve(fixturePath("js-pnpm-good")));
    expect(repos[0]?.error).toBeUndefined();
    expect(cleanups).toHaveLength(0); // local dirs are not cloned/cleaned
  });

  it("marks an unrecognized spec as an error", () => {
    const { repos } = resolveTargets(["this is not a repo spec"]);
    expect(repos[0]?.error).toContain("not a directory");
  });

  it("reports progress for each resolved target", () => {
    const seen: string[] = [];
    resolveTargets([fixturePath("js-pnpm-good"), fixturePath("ruby-good")], {
      onProgress: (p) => {
        if (p.phase === "resolving") seen.push(p.spec);
      },
    });
    expect(seen).toHaveLength(2);
  });
});
