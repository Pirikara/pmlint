import type { Severity } from "../model/types.js";
import { RULE_IDS, type RuleId } from "../rules/ids.js";
import type { PresetName } from "./types.js";

type RuleSeverities = Partial<Record<RuleId, Severity>>;

/** Every rule defaults to off; presets opt rules in. */
function allOff(): Record<RuleId, Severity> {
  return Object.fromEntries(RULE_IDS.map((id) => [id, "off"])) as Record<RuleId, Severity>;
}

const recommended: RuleSeverities = {
  "lockfile/required": "warn",
  "js/no-foreign-lockfiles": "error",
  "js/single-manager": "warn",
  // Version-pinning in the manifest is lower priority when a committed lockfile
  // already pins resolved versions, so these are warnings here (app-strict
  // raises them to errors for deployed apps).
  "deps/no-floating-version": "warn",
  "deps/no-dist-tag": "warn",
  "deps/no-unbounded-range": "warn",
  "deps/no-unpinned-vcs-source": "warn",
  "install/no-mutating-install-in-ci": "error",
  "install/no-update-command-in-ci": "error",
  "registry/no-plaintext-token": "error",
  "registry/no-insecure-registry": "warn",
  "dependabot/config-present": "warn",
  "dependabot/no-duplicate-config": "warn",
  "dependabot/directories-cover-manifests": "warn",
  "dependabot/ecosystem-matches-manager": "warn",
  // On by default: only fires when a dependabot.yml exists, so low-noise.
  "dependabot/release-cooldown": "warn",
};

// app-strict layers stricter severities on top of recommended. It relies on the
// generic rules (lockfile/*, install/*, deps/*) for cross-ecosystem coverage and
// only adds the genuinely-additional checks; ecosystem-specific rules that would
// merely duplicate a generic rule stay off.
const appStrict: RuleSeverities = {
  ...recommended,
  "lockfile/required": "error",
  // Deployed apps want exact/narrow direct deps regardless of the lockfile.
  "deps/no-floating-version": "error",
  "deps/no-dist-tag": "error",
  "deps/no-unbounded-range": "error",
  "deps/no-unpinned-vcs-source": "error",
  "js/single-manager": "error",
  "js/package-manager-pinned": "error",
  "js/release-age-gate": "warn",
  "js/save-exact-configured": "warn",
  "registry/no-insecure-registry": "error",
  "dependabot/config-present": "error",
  "dependabot/directories-cover-manifests": "error",
  "dependabot/ecosystem-matches-manager": "error",
  "dependabot/github-actions-updates": "warn",
  // Complements deps/* by also flagging bounded ranges that are not exact pins.
  "python/requirements-pinned": "error",
  // (dependabot/release-cooldown is inherited as warn from recommended.)
};

const libraryRecommended: RuleSeverities = {
  ...recommended,
  // Libraries may publish open ranges and may not commit a lockfile.
  "lockfile/required": "off",
  "deps/no-unbounded-range": "off",
  "js/single-manager": "off",
  // CI should still install deterministically.
  "install/no-mutating-install-in-ci": "error",
  "install/no-update-command-in-ci": "error",
};

const PRESETS: Record<PresetName, RuleSeverities> = {
  recommended,
  "app-strict": appStrict,
  "library-recommended": libraryRecommended,
};

export function isPresetName(name: string): name is PresetName {
  return name in PRESETS;
}

/** Resolve a preset name into a full rule-severity map (off-by-default base). */
export function presetRules(name: PresetName): Record<RuleId, Severity> {
  return { ...allOff(), ...PRESETS[name] };
}

export const DEFAULT_PRESET: PresetName = "recommended";
