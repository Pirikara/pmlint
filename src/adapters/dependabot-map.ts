import type { PackageManager } from "../model/types.js";

/**
 * Maps a detected package manager to the `package-ecosystem` value Dependabot
 * expects. Lives in adapter metadata so it can evolve independently.
 */
export const dependabotEcosystemByManager: Record<PackageManager, string> = {
  npm: "npm",
  pnpm: "npm",
  yarn: "npm",
  bun: "bun",
  bundler: "bundler",
  pip: "pip",
  "pip-tools": "pip",
  poetry: "pip",
  uv: "uv",
  go: "gomod",
  composer: "composer",
  maven: "maven",
  gradle: "gradle",
  cargo: "cargo",
  nuget: "nuget",
  pub: "pub",
  swift: "swift",
  hex: "mix",
};

/** Dependabot ecosystem aliases that should be treated as equivalent on read. */
const ALIASES: Record<string, string> = {
  npm: "npm",
  yarn: "npm",
  pnpm: "npm",
};

export function normalizeDependabotEcosystem(value: string): string {
  const v = value.trim().toLowerCase();
  return ALIASES[v] ?? v;
}
