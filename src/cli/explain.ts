import {
  dependabotEcosystemByManager,
  normalizeDependabotEcosystem,
} from "../adapters/dependabot-map.js";
import { baseOf } from "../fs/discovery.js";
import { normalizeDir } from "../dependabot/parse.js";
import type {
  PackageManager,
  PackageSurface,
  RepositoryState,
} from "../model/types.js";

/** Human-readable summary of detected dependency surfaces (no pass/fail). */
export function renderExplain(state: RepositoryState): string {
  const lines: string[] = [];
  lines.push(`Repository: ${state.root}`);

  if (state.packageSurfaces.length === 0) {
    lines.push("No package roots detected.");
    return lines.join("\n");
  }

  lines.push("Detected ecosystems:");
  for (const surface of state.packageSurfaces) {
    lines.push("");
    lines.push(`  ${surface.ecosystem} (${surface.root}):`);
    lines.push(`    manager: ${surface.manager}`);
    lines.push(`    manifest: ${manifestLabel(surface)}`);
    lines.push(`    lockfile: ${lockfileLabel(surface)}`);
    lines.push(`    dependabot: ${dependabotLabel(surface, state)}`);
    lines.push(`    ci install: ${ciLabel(surface, state)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function manifestLabel(surface: PackageSurface): string {
  const first = surface.manifests[0];
  return first ? baseOf(first.path) : "none";
}

function lockfileLabel(surface: PackageSurface): string {
  if (surface.lockfiles.length === 0) {
    return "missing";
  }
  return surface.lockfiles.map((l) => baseOf(l.path)).join(", ");
}

function dependabotLabel(surface: PackageSurface, state: RepositoryState): string {
  const { dependabot } = state;
  if (!dependabot.configPath || !dependabot.updates) {
    return "missing";
  }
  if (surface.manager === "unknown") {
    return "unknown";
  }
  const eco = dependabotEcosystemByManager[surface.manager as PackageManager];
  const covered = dependabot.updates.some(
    (entry) =>
      normalizeDependabotEcosystem(entry.packageEcosystem) === eco &&
      entry.directories.some((d) => {
        const dir = normalizeDir(d);
        return dir === surface.root || (dir === "." && surface.root === ".");
      }),
  );
  return covered ? "covered" : "not covered";
}

function ciLabel(surface: PackageSurface, state: RepositoryState): string {
  const relevant = state.ci.commands.filter((c) => c.manager === surface.manager);
  if (relevant.length === 0) {
    return "not detected";
  }
  if (relevant.some((c) => c.isUpdate)) {
    return "update command present";
  }
  if (relevant.some((c) => c.isFrozen)) {
    return "frozen";
  }
  if (relevant.some((c) => c.isMutatingInstall)) {
    return "mutating";
  }
  return "detected";
}
