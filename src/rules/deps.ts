import type { DependencySpec } from "../model/types.js";
import type { Finding, Rule, RuleContext } from "./types.js";

function eachDependency(ctx: RuleContext): DependencySpec[] {
  return ctx.state.packageSurfaces
    .filter((s) => ctx.config.ecosystems[s.ecosystem])
    .flatMap((s) => s.dependencySpecs);
}

export const noFloatingVersion: Rule = {
  id: "deps/no-floating-version",
  check(ctx) {
    const findings: Finding[] = [];
    for (const dep of eachDependency(ctx)) {
      const { kind, isFloating } = dep.parsed;
      // Dist tags are handled by deps/no-dist-tag to avoid double reporting.
      if (isFloating && (kind === "wildcard" || kind === "empty")) {
        const shown = dep.rawSpec.trim() === "" ? "(empty)" : `"${dep.rawSpec}"`;
        findings.push({
          message: `Dependency "${dep.dependencyName}" uses ${shown}, which can resolve to any future version.`,
          filePath: dep.manifestPath,
          line: dep.line,
          suggestion: "Use an exact version or a bounded range.",
        });
      }
    }
    return findings;
  },
};

export const noDistTag: Rule = {
  id: "deps/no-dist-tag",
  check(ctx) {
    const findings: Finding[] = [];
    for (const dep of eachDependency(ctx)) {
      if (dep.parsed.kind === "dist-tag") {
        findings.push({
          message: `Dependency "${dep.dependencyName}" uses the "${dep.parsed.distTag}" dist tag.`,
          filePath: dep.manifestPath,
          line: dep.line,
          suggestion: "Dist tags can move without a repository change. Pin a version instead.",
        });
      }
    }
    return findings;
  },
};

export const noUnboundedRange: Rule = {
  id: "deps/no-unbounded-range",
  check(ctx) {
    const findings: Finding[] = [];
    for (const dep of eachDependency(ctx)) {
      if (dep.parsed.isUnbounded) {
        findings.push({
          message: `Dependency "${dep.dependencyName}" uses "${dep.rawSpec}", an unbounded range with no upper limit.`,
          filePath: dep.manifestPath,
          line: dep.line,
          suggestion: "Add an upper bound so future major versions are not pulled in automatically.",
        });
      }
    }
    return findings;
  },
};

export const noUnpinnedVcsSource: Rule = {
  id: "deps/no-unpinned-vcs-source",
  check(ctx) {
    const findings: Finding[] = [];
    for (const dep of eachDependency(ctx)) {
      if (dep.parsed.kind === "vcs" && dep.parsed.isPinnedVcs === false) {
        findings.push({
          message: `Dependency "${dep.dependencyName}" points at a moving VCS ref without a pinned commit or tag.`,
          filePath: dep.manifestPath,
          line: dep.line,
          suggestion: "Pin the dependency to an immutable commit hash or tag.",
        });
      }
    }
    return findings;
  },
};

export const depsRules: Rule[] = [
  noFloatingVersion,
  noDistTag,
  noUnboundedRange,
  noUnpinnedVcsSource,
];
