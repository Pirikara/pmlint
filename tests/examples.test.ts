import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";

const examplesDir = fileURLToPath(new URL("../examples", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const exampleFiles = readdirSync(examplesDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

describe("example configs", () => {
  it("ships at least the documented samples", () => {
    expect(exampleFiles).toContain("pmlint.recommended.yml");
    expect(exampleFiles).toContain("pmlint.app-strict.yml");
    expect(exampleFiles).toContain("org-policy.yml");
    expect(exampleFiles).toContain("dependabot-only.yml");
  });

  // Every sample must load via the real loader (catches unknown rule ids,
  // invalid presets, and bad severities before they ship).
  it.each(exampleFiles)("%s loads and resolves cleanly", (file) => {
    const config = loadConfig(repoRoot, {
      configPath: path.join(examplesDir, file),
      env: {},
    });
    expect(config.projectType).toBeDefined();
    expect(Object.keys(config.rules).length).toBeGreaterThan(0);
  });

  it("dependabot-only.yml only enables dependabot rules", () => {
    const config = loadConfig(repoRoot, {
      configPath: path.join(examplesDir, "dependabot-only.yml"),
      env: {},
    });
    const active = Object.entries(config.rules).filter(([, sev]) => sev !== "off");
    expect(active.length).toBeGreaterThan(0);
    expect(active.every(([id]) => id.startsWith("dependabot/"))).toBe(true);
  });
});
