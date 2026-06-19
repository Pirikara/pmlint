import type { Discovery } from "../fs/discovery.js";
import { parseYamlSafe } from "../fs/parse.js";
import type {
  DependabotCooldown,
  DependabotState,
  DependabotUpdateEntry,
} from "../model/types.js";
import type { AddDiagnostic } from "../adapters/types.js";

const YML = ".github/dependabot.yml";
const YAML = ".github/dependabot.yaml";

export function parseDependabot(input: Discovery, addDiag: AddDiagnostic): DependabotState {
  const hasYml = input.files.includes(YML);
  const hasYaml = input.files.includes(YAML);

  if (!hasYml && !hasYaml) {
    return { duplicate: false };
  }

  const configPath = hasYml ? YML : YAML;
  const duplicate = hasYml && hasYaml;

  const text = input.read(configPath);
  if (text === undefined) {
    return { configPath, duplicate, parseError: true };
  }

  const parsed = parseYamlSafe<Record<string, unknown>>(text);
  if (!parsed.ok) {
    addDiag({
      ruleId: "config/parse-error",
      severity: "error",
      message: "Could not parse Dependabot config (YAML).",
      filePath: configPath,
    });
    return { configPath, duplicate, parseError: true };
  }

  const raw = parsed.value;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.updates)) {
    return { configPath, raw: text, duplicate, updates: [] };
  }

  const updates: DependabotUpdateEntry[] = [];
  for (const entry of raw.updates as unknown[]) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const packageEcosystem =
      typeof e["package-ecosystem"] === "string" ? (e["package-ecosystem"] as string) : "";
    const directories = normalizeDirectories(e.directory, e.directories);
    const cooldown = parseCooldown(e.cooldown);
    updates.push(cooldown ? { packageEcosystem, directories, cooldown } : { packageEcosystem, directories });
  }

  return { configPath, raw: text, duplicate, updates };
}

function normalizeDirectories(directory: unknown, directories: unknown): string[] {
  const out = new Set<string>();
  if (typeof directory === "string") {
    out.add(normalizeDir(directory));
  }
  if (Array.isArray(directories)) {
    for (const d of directories) {
      if (typeof d === "string") {
        out.add(normalizeDir(d));
      }
    }
  }
  return [...out];
}

function parseCooldown(value: unknown): DependabotCooldown | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const c = value as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const cooldown: DependabotCooldown = {
    defaultDays: num(c["default-days"]),
    semverMajorDays: num(c["semver-major-days"]),
    semverMinorDays: num(c["semver-minor-days"]),
    semverPatchDays: num(c["semver-patch-days"]),
  };
  return cooldown;
}

/** Normalize a Dependabot `directory` value to a repo-relative path. */
export function normalizeDir(dir: string): string {
  let d = dir.trim();
  if (d === "/" || d === "" || d === ".") {
    return ".";
  }
  d = d.replace(/^\/+/, "").replace(/\/+$/, "");
  return d === "" ? "." : d;
}
