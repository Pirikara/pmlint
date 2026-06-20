import type { Finding, Rule } from "./types.js";

/**
 * Flags GitHub Actions `uses:` references that are not pinned to a full commit
 * SHA. Mutable tags (`@v4`) and branches (`@main`) can be moved by the action
 * owner (or an attacker who compromises it), so pinning to an immutable commit
 * is the supply-chain-safe form. Local actions (`./...`) are exempt.
 */
export const noUnpinnedUses: Rule = {
  id: "actions/no-unpinned-uses",
  check(ctx) {
    const findings: Finding[] = [];
    for (const action of ctx.state.ci.actions) {
      if (action.isLocal || action.isPinned) {
        continue;
      }
      const refNote = action.ref ? ` (\`@${action.ref}\`)` : "";
      findings.push({
        message: `Action "${action.raw}" is not pinned to a full commit SHA${refNote}.`,
        filePath: action.filePath,
        line: action.line,
        suggestion: "Pin to an immutable commit SHA, e.g. `owner/repo@<sha> # v4`.",
      });
    }
    return findings;
  },
};

export const actionsRules: Rule[] = [noUnpinnedUses];
