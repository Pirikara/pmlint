import { describe, expect, it } from "vitest";
import { matchesWorkspaceGlob } from "../src/util/workspace.js";

describe("matchesWorkspaceGlob", () => {
  it("matches a single-segment wildcard but not across slashes", () => {
    expect(matchesWorkspaceGlob("packages/api", "packages/*")).toBe(true);
    expect(matchesWorkspaceGlob("packages/api/nested", "packages/*")).toBe(false);
  });

  it("matches across slashes with a double wildcard", () => {
    expect(matchesWorkspaceGlob("packages/api/nested", "packages/**")).toBe(true);
  });

  it("matches an exact path", () => {
    expect(matchesWorkspaceGlob("apps/web", "apps/web")).toBe(true);
    expect(matchesWorkspaceGlob("apps/web", "apps/api")).toBe(false);
  });

  it("does not match an unrelated path", () => {
    expect(matchesWorkspaceGlob("sub", "packages/*")).toBe(false);
  });
});
