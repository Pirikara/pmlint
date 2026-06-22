import { describe, expect, it } from "vitest";
import { orgReposCommand } from "../src/fleet/sources.js";

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
