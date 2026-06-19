import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, resolveConfig } from "../src/config/load.js";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

describe("resolveConfig", () => {
  it("defaults to the recommended preset", () => {
    const config = resolveConfig({});
    // Version-pinning is a warning in recommended (lockfile already pins versions).
    expect(config.rules["deps/no-floating-version"]).toBe("warn");
    expect(config.rules["js/no-foreign-lockfiles"]).toBe("error");
    expect(config.rules["js/package-manager-pinned"]).toBe("off");
    expect(config.projectType).toBe("app");
  });

  it("applies the app-strict preset and its implied options", () => {
    const config = resolveConfig({ extends: "app-strict" });
    expect(config.rules["js/package-manager-pinned"]).toBe("error");
    expect(config.rules["lockfile/required"]).toBe("error");
    // app-strict raises version-pinning back to errors.
    expect(config.rules["deps/no-floating-version"]).toBe("error");
    expect(config.rules["deps/no-unbounded-range"]).toBe("error");
    expect(config.rules["python/requirements-pinned"]).toBe("error");
    expect(config.options.requireExactPackageManagerVersion).toBe(true);
  });

  it("relaxes ranges in library-recommended", () => {
    const config = resolveConfig({ extends: "library-recommended" });
    expect(config.rules["deps/no-unbounded-range"]).toBe("off");
    expect(config.rules["install/no-mutating-install-in-ci"]).toBe("error");
  });

  it("lets explicit rule overrides win", () => {
    const config = resolveConfig({ rules: { "deps/no-dist-tag": "off" } });
    expect(config.rules["deps/no-dist-tag"]).toBe("off");
  });

  it("maps policy booleans onto rule severities", () => {
    const config = resolveConfig({ dependencies: { forbidFloatingVersions: false } });
    expect(config.rules["deps/no-floating-version"]).toBe("off");
  });

  it("toggles ecosystems", () => {
    const config = resolveConfig({ ecosystems: { ruby: { enabled: false } } });
    expect(config.ecosystems.ruby).toBe(false);
    expect(config.ecosystems.javascript).toBe(true);
  });

  it("rejects unknown rule ids", () => {
    expect(() => resolveConfig({ rules: { "nope/nope": "error" } })).toThrow(ConfigError);
  });

  it("rejects unknown presets", () => {
    expect(() => resolveConfig({ extends: "ultra" })).toThrow(ConfigError);
  });

  it("rejects invalid severities", () => {
    expect(() => resolveConfig({ rules: { "deps/no-dist-tag": "fatal" as never } })).toThrow(
      ConfigError,
    );
  });
});

describe("loadConfig source precedence (fleet/audit)", () => {
  const repoWithLocal = fixturePath("config-fail-on-warnings");

  it("discovers a repo-local config by default", () => {
    const config = loadConfig(repoWithLocal, { env: {} });
    expect(config.failOnWarnings).toBe(true);
  });

  it("ignores repo-local config when noRepoConfig is set", () => {
    const config = loadConfig(repoWithLocal, { noRepoConfig: true, env: {} });
    expect(config.failOnWarnings).toBe(false);
  });

  it("treats an explicit --config as authoritative over repo-local", () => {
    const config = loadConfig(repoWithLocal, {
      configPath: fixturePath("policy-app-strict/policy.yml"),
      env: {},
    });
    // The central policy wins; the repo's failOnWarnings is not applied.
    expect(config.rules["js/package-manager-pinned"]).toBe("error");
    expect(config.failOnWarnings).toBe(false);
  });

  it("reads PMLINT_CONFIG from the environment and skips repo-local", () => {
    const config = loadConfig(repoWithLocal, {
      env: { PMLINT_CONFIG: fixturePath("policy-app-strict/policy.yml") },
    });
    expect(config.rules["js/package-manager-pinned"]).toBe("error");
    expect(config.failOnWarnings).toBe(false);
  });
});
