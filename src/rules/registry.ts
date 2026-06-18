import { findLine } from "../fs/parse.js";
import type { FileFix, PackageManagerConfig } from "../model/types.js";
import type { Finding, Rule, RuleContext } from "./types.js";

/** Patterns that indicate a committed plaintext token (value never printed). */
const TOKEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /_authToken\s*=\s*(.+)$/m, label: "npm auth token" },
  { re: /(?:^|[^a-zA-Z])_auth\s*=\s*(.+)$/m, label: "npm basic-auth credential" },
  { re: /_password\s*=\s*(.+)$/m, label: "npm registry password" },
  { re: /npmAuthToken\s*:\s*(.+)$/m, label: "npm auth token" },
  { re: /npmAuthIdent\s*:\s*(.+)$/m, label: "npm auth identity" },
  { re: /GEM_HOST_API_KEY\s*[:=]\s*(.+)$/m, label: "RubyGems API key" },
  { re: /pypi-token\s*[:=-]?\s*(\S+)/m, label: "PyPI token" },
];

const INSECURE_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /registry\s*=\s*http:\/\//i, message: "Registry is configured over plaintext HTTP." },
  { re: /Registry\s*:?\s*"?http:\/\//i, message: "Registry is configured over plaintext HTTP." },
  { re: /npmRegistryServer\s*:\s*http:\/\//i, message: "Registry is configured over plaintext HTTP." },
  { re: /index-url\s*=\s*http:\/\//i, message: "Package index is configured over plaintext HTTP." },
  { re: /strict-ssl\s*=\s*false/i, message: "TLS verification is disabled (strict-ssl=false)." },
];

function allConfigs(ctx: RuleContext): PackageManagerConfig[] {
  return ctx.state.packageSurfaces
    .filter((s) => ctx.config.ecosystems[s.ecosystem])
    .flatMap((s) => s.configs);
}

/** A value that is empty or an env-var interpolation is not a committed secret. */
function isLiteralSecret(value: string): boolean {
  const v = value.trim().replace(/^["']|["']$/g, "");
  if (v === "") {
    return false;
  }
  if (v.startsWith("$") || /\$\{.*\}/.test(v) || /\$\(.*\)/.test(v)) {
    return false;
  }
  return true;
}

export const noPlaintextToken: Rule = {
  id: "registry/no-plaintext-token",
  check(ctx) {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const config of allConfigs(ctx)) {
      if (typeof config.raw !== "string") {
        continue;
      }
      for (const { re, label } of TOKEN_PATTERNS) {
        const m = re.exec(config.raw);
        if (!m) {
          continue;
        }
        const value = m[m.length - 1] ?? "";
        if (!isLiteralSecret(value)) {
          continue;
        }
        const key = `${config.path}:${label}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        findings.push({
          // Never include the secret value itself.
          message: `Found a plaintext ${label} committed in ${config.kind}.`,
          filePath: config.path,
          suggestion: "Move the credential to an environment variable or CI secret.",
        });
      }
    }
    return findings;
  },
};

export const noInsecureRegistry: Rule = {
  id: "registry/no-insecure-registry",
  check(ctx) {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const config of allConfigs(ctx)) {
      if (typeof config.raw !== "string") {
        continue;
      }
      for (const { re, message } of INSECURE_PATTERNS) {
        if (re.test(config.raw)) {
          const key = `${config.path}:${message}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          findings.push({
            message,
            filePath: config.path,
            suggestion: "Use HTTPS and keep TLS verification enabled.",
            fix: httpToHttpsFix(config),
          });
        }
      }
    }
    return findings;
  },
};

/** Only the plaintext-HTTP case is safely auto-fixable (strict-ssl removal is not). */
function httpToHttpsFix(config: PackageManagerConfig): FileFix | undefined {
  if (typeof config.raw !== "string" || !config.raw.includes("http://")) {
    return undefined;
  }
  const line = findLine(config.raw, "http://");
  if (line === undefined) {
    return undefined;
  }
  return {
    kind: "replace-line",
    filePath: config.path,
    line,
    find: "http://",
    replace: "https://",
    description: "Switch the registry URL from http:// to https://",
  };
}

export const registryRules: Rule[] = [noPlaintextToken, noInsecureRegistry];
