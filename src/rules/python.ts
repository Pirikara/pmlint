import type { PackageSurface } from "../model/types.js";
import type { Finding, Rule, RuleContext } from "./types.js";

function pythonSurfaces(ctx: RuleContext): PackageSurface[] {
  return ctx.state.packageSurfaces.filter(
    (s) => s.ecosystem === "python" && ctx.config.ecosystems.python,
  );
}

export const lockfileRequired: Rule = {
  id: "python/lockfile-required",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of pythonSurfaces(ctx)) {
      if (surface.lockfiles.length === 0) {
        findings.push({
          message: `Python package root "${surface.root}" (${surface.manager}) has no lockfile.`,
          filePath: surface.manifests[0]?.path ?? surface.root,
          suggestion: lockHint(surface.manager),
        });
      }
    }
    return findings;
  },
};

export const requirementsPinned: Rule = {
  id: "python/requirements-pinned",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of pythonSurfaces(ctx)) {
      for (const dep of surface.dependencySpecs) {
        // Floating/unbounded specs are handled by the generic deps rules; this
        // rule adds the stricter "bounded ranges are not exact pins" check.
        if (dep.parsed.kind === "range") {
          findings.push({
            message: `Requirement "${dep.dependencyName}" is not pinned to an exact version.`,
            filePath: dep.manifestPath,
            line: dep.line,
            suggestion: `Use "${dep.dependencyName}==<version>" for deterministic installs.`,
          });
        }
      }
    }
    return findings;
  },
};

export const requireHashes: Rule = {
  id: "python/require-hashes",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of pythonSurfaces(ctx)) {
      for (const manifest of surface.manifests) {
        if (manifest.kind !== "requirements.txt") {
          continue;
        }
        if (typeof manifest.raw !== "string" || surface.dependencySpecs.length === 0) {
          continue;
        }
        if (!/--hash=/.test(manifest.raw)) {
          findings.push({
            message: `${manifest.path} does not use hash pinning.`,
            filePath: manifest.path,
            suggestion: "Generate hashes (e.g. `pip-compile --generate-hashes`) and install with `--require-hashes`.",
          });
        }
      }
    }
    return findings;
  },
};

export const noUnpinnedVcsRequirement: Rule = {
  id: "python/no-unpinned-vcs-requirement",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of pythonSurfaces(ctx)) {
      for (const dep of surface.dependencySpecs) {
        if (dep.parsed.kind === "vcs" && dep.parsed.isPinnedVcs === false) {
          findings.push({
            message: `Requirement "${dep.dependencyName}" points at a VCS source without a pinned commit or tag.`,
            filePath: dep.manifestPath,
            line: dep.line,
            suggestion: "Append `@<commit-or-tag>` to the VCS URL.",
          });
        }
      }
    }
    return findings;
  },
};

export const poetryLockfileRequired: Rule = {
  id: "poetry/lockfile-required",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of pythonSurfaces(ctx)) {
      if (surface.manager !== "poetry") {
        continue;
      }
      const hasPoetryLock = surface.lockfiles.some((l) => l.kind === "poetry.lock");
      if (!hasPoetryLock) {
        findings.push({
          message: `Poetry is used in "${surface.root}" but poetry.lock is missing.`,
          filePath: surface.manifests[0]?.path ?? surface.root,
          suggestion: "Run `poetry lock` and commit poetry.lock.",
        });
      }
    }
    return findings;
  },
};

export const uvLockedInCi: Rule = {
  id: "uv/locked-in-ci",
  check(ctx) {
    const usesUv = ctx.state.packageSurfaces.some(
      (s) => s.ecosystem === "python" && s.manager === "uv",
    );
    if (!usesUv || !ctx.config.ecosystems.python) {
      return [];
    }
    const findings: Finding[] = [];
    for (const cmd of ctx.state.ci.commands) {
      if (cmd.manager === "uv" && cmd.isMutatingInstall && !cmd.isFrozen) {
        findings.push({
          message: `"${cmd.raw}" runs uv without --locked/--frozen in CI.`,
          filePath: cmd.filePath,
          line: cmd.line,
          suggestion: "Use `uv sync --locked` (or `--frozen`) in CI.",
        });
      }
    }
    return findings;
  },
};

function lockHint(manager: PackageSurface["manager"]): string {
  switch (manager) {
    case "poetry":
      return "Commit poetry.lock.";
    case "uv":
      return "Commit uv.lock (or pylock.toml).";
    case "pip-tools":
      return "Generate and commit requirements.txt with pip-compile.";
    default:
      return "Commit a fully pinned requirements.txt.";
  }
}

export const pythonRules: Rule[] = [
  lockfileRequired,
  requirementsPinned,
  requireHashes,
  noUnpinnedVcsRequirement,
  poetryLockfileRequired,
  uvLockedInCi,
];
