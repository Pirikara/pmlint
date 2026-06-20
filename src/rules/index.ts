import { actionsRules } from "./actions.js";
import { depsRules } from "./deps.js";
import { dependabotRules } from "./dependabot.js";
import { installRules } from "./install.js";
import { javascriptRules } from "./javascript.js";
import { lockfileRules } from "./lockfile.js";
import { pythonRules } from "./python.js";
import { registryRules } from "./registry.js";
import { rubyRules } from "./ruby.js";
import type { Rule } from "./types.js";

/** Every rule pmlint ships, in a stable order. */
export const ALL_RULES: Rule[] = [
  ...lockfileRules,
  ...javascriptRules,
  ...depsRules,
  ...installRules,
  ...actionsRules,
  ...registryRules,
  ...dependabotRules,
  ...rubyRules,
  ...pythonRules,
];
