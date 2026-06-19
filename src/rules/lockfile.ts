import type { PackageEcosystem } from "../model/types.js";
import { collectWorkspaceRoots, isWorkspaceMember } from "../util/workspace.js";
import type { Rule, RuleContext } from "./types.js";

const ECOSYSTEM_HINT: Record<PackageEcosystem, string> = {
  javascript: "Commit a lockfile (e.g. pnpm-lock.yaml / package-lock.json).",
  ruby: "Commit Gemfile.lock.",
  python: "Commit a lockfile (poetry.lock / uv.lock) or a fully pinned requirements.txt.",
  go: "Commit go.sum.",
  php: "Commit composer.lock.",
  java: "Enable dependency locking and commit the lockfile.",
};

// Ecosystems without a universal lockfile concept are not required to have one.
// (Maven has no standard lockfile; Gradle locking is opt-in.)
const NO_LOCKFILE_REQUIRED = new Set<PackageEcosystem>(["java"]);

export const lockfileRequired: Rule = {
  id: "lockfile/required",
  check(ctx: RuleContext) {
    const surfaces = ctx.state.packageSurfaces.filter(
      (s) => ctx.config.ecosystems[s.ecosystem],
    );
    // Only a *declared* workspace member is exempt from having its own lockfile;
    // its dependencies are resolved by the single lockfile at the workspace root.
    // A package root that merely happens to sit under another root's lockfile is
    // NOT covered — it must have a colocated lockfile.
    const workspaceRoots = collectWorkspaceRoots(surfaces);

    const findings = [];
    for (const surface of surfaces) {
      if (NO_LOCKFILE_REQUIRED.has(surface.ecosystem)) {
        continue;
      }
      if (surface.lockfiles.length > 0) {
        continue;
      }
      if (isWorkspaceMember(surface, workspaceRoots)) {
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
