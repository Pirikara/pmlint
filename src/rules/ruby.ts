import type { PackageSurface } from "../model/types.js";
import type { Finding, Rule, RuleContext } from "./types.js";

function rubySurfaces(ctx: RuleContext): PackageSurface[] {
  return ctx.state.packageSurfaces.filter(
    (s) => s.ecosystem === "ruby" && ctx.config.ecosystems.ruby,
  );
}

export const gemfileLockRequired: Rule = {
  id: "ruby/gemfile-lock-required",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of rubySurfaces(ctx)) {
      const hasGemfile = surface.manifests.some((m) => m.kind === "Gemfile");
      if (hasGemfile && surface.lockfiles.length === 0) {
        findings.push({
          message: `"${surface.root}" has a Gemfile but no Gemfile.lock.`,
          filePath: surface.manifests.find((m) => m.kind === "Gemfile")?.path,
          suggestion: "Run `bundle install` and commit Gemfile.lock.",
        });
      }
    }
    return findings;
  },
};

export const frozenInstallInCi: Rule = {
  id: "ruby/frozen-install-in-ci",
  check(ctx) {
    const findings: Finding[] = [];
    for (const cmd of ctx.state.ci.commands) {
      if (cmd.manager === "bundler" && cmd.isMutatingInstall && !cmd.isFrozen) {
        findings.push({
          message: `Bundler install "${cmd.raw}" in CI is not frozen.`,
          filePath: cmd.filePath,
          line: cmd.line,
          suggestion: "Set `bundle config set frozen true` (or deployment) before installing.",
        });
      }
    }
    return findings;
  },
};

export const noUnpinnedGitSource: Rule = {
  id: "ruby/no-unpinned-git-source",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of rubySurfaces(ctx)) {
      for (const dep of surface.dependencySpecs) {
        if (dep.parsed.kind === "vcs" && dep.parsed.isPinnedVcs === false) {
          findings.push({
            message: `Gem "${dep.dependencyName}" uses a moving git ref without a tag or commit.`,
            filePath: dep.manifestPath,
            line: dep.line,
            suggestion: "Pin the gem to a tag or commit (`tag:` or `ref:`).",
          });
        }
      }
    }
    return findings;
  },
};

export const noUnboundedGemVersion: Rule = {
  id: "ruby/no-unbounded-gem-version",
  check(ctx) {
    const findings: Finding[] = [];
    for (const surface of rubySurfaces(ctx)) {
      for (const dep of surface.dependencySpecs) {
        const { kind, isUnbounded } = dep.parsed;
        if (isUnbounded || kind === "empty") {
          findings.push({
            message: `Gem "${dep.dependencyName}" has a permissive version constraint.`,
            filePath: dep.manifestPath,
            line: dep.line,
            suggestion: "Use a bounded constraint such as `~> x.y`.",
          });
        }
      }
    }
    return findings;
  },
};

export const rubyRules: Rule[] = [
  gemfileLockRequired,
  frozenInstallInCi,
  noUnpinnedGitSource,
  noUnboundedGemVersion,
];
