import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

export const STARTER_CONFIG = `# pmlint configuration
# Docs: https://github.com/pmlint/pmlint

extends:
  - recommended

project:
  type: app # app | library | cli | monorepo

ecosystems:
  javascript:
    enabled: true
  ruby:
    enabled: true
  python:
    enabled: true

# Fail the command on warnings too (errors always fail).
ci:
  failOnWarnings: false

# Override individual rule severities (off | warn | error).
rules:
  dependabot/config-present: warn

# Glob patterns to skip during discovery.
ignore:
  - "**/fixtures/**"
`;

export type InitResult = { created: boolean; path: string };

/** Write a starter pmlint.yml, refusing to overwrite an existing config. */
export function runInit(root: string): InitResult {
  const target = path.join(root, "pmlint.yml");
  if (existsSync(target)) {
    return { created: false, path: target };
  }
  writeFileSync(target, STARTER_CONFIG, "utf8");
  return { created: true, path: target };
}
