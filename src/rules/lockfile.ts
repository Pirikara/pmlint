import { dirOf } from "../fs/discovery.js";
import type { PackageEcosystem, PackageSurface } from "../model/types.js";
import { isAtOrUnder } from "../util/paths.js";
import type { Rule, RuleContext } from "./types.js";

/**
 * A surface is lock-covered when a lockfile of the same ecosystem exists at its
 * own root or at an ancestor directory (handles monorepos where the lockfile
 * lives only at the workspace root).
 */
function isLockCovered(surface: PackageSurface, all: PackageSurface[]): boolean {
  if (surface.lockfiles.length > 0) {
    return true;
  }
  const ecosystemLockDirs = all
    .filter((s) => s.ecosystem === surface.ecosystem)
    .flatMap((s) => s.lockfiles.map((l) => dirOf(l.path)));

  return ecosystemLockDirs.some((lockDir) => isAtOrUnder(surface.root, lockDir));
}

const ECOSYSTEM_HINT: Record<PackageEcosystem, string> = {
  javascript: "Commit a lockfile (e.g. pnpm-lock.yaml / package-lock.json).",
  ruby: "Commit Gemfile.lock.",
  python: "Commit a lockfile (poetry.lock / uv.lock) or a fully pinned requirements.txt.",
};

export const lockfileRequired: Rule = {
  id: "lockfile/required",
  check(ctx: RuleContext) {
    const surfaces = ctx.state.packageSurfaces.filter(
      (s) => ctx.config.ecosystems[s.ecosystem],
    );
    const findings = [];
    for (const surface of surfaces) {
      if (isLockCovered(surface, surfaces)) {
        continue;
      }
      const manifest = surface.manifests[0];
      findings.push({
        message: `Package root "${surface.root}" has no lockfile.`,
        filePath: manifest?.path ?? surface.root,
        suggestion: ECOSYSTEM_HINT[surface.ecosystem],
      });
    }
    return findings;
  },
};

export const lockfileRules: Rule[] = [lockfileRequired];
