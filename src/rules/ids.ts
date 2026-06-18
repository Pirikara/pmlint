/** Canonical list of every rule id pmlint knows about. */
export const RULE_IDS = [
  // Core / lockfile
  "lockfile/required",
  // JavaScript
  "js/no-foreign-lockfiles",
  "js/single-manager",
  "js/package-manager-pinned",
  "js/release-age-gate",
  "js/save-exact-configured",
  // Generic dependency quality (operate on normalized specs, all ecosystems)
  "deps/no-floating-version",
  "deps/no-dist-tag",
  "deps/no-unbounded-range",
  "deps/no-unpinned-vcs-source",
  // Install / CI
  "install/no-mutating-install-in-ci",
  "install/no-update-command-in-ci",
  // Registry
  "registry/no-plaintext-token",
  "registry/no-insecure-registry",
  // Dependabot
  "dependabot/config-present",
  "dependabot/no-duplicate-config",
  "dependabot/directories-cover-manifests",
  "dependabot/ecosystem-matches-manager",
  "dependabot/github-actions-updates",
  // Ruby-specific (off by default; generic deps rules cover the common cases)
  "ruby/gemfile-lock-required",
  "ruby/frozen-install-in-ci",
  "ruby/no-unpinned-git-source",
  "ruby/no-unbounded-gem-version",
  // Python-specific
  "python/lockfile-required",
  "python/requirements-pinned",
  "python/require-hashes",
  "python/no-unpinned-vcs-requirement",
  "poetry/lockfile-required",
  "uv/locked-in-ci",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export function isKnownRuleId(id: string): id is RuleId {
  return (RULE_IDS as readonly string[]).includes(id);
}
