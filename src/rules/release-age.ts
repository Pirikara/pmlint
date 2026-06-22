import type { PackageManagerConfig, PackageSurface } from "../model/types.js";

/** A configured gate: a concrete age in seconds, or present-but-unmeasurable. */
export type GateValue = number | "present" | undefined;

const SECONDS_PER_DAY = 86_400;

export function daysToSeconds(days: number): number {
  return days * SECONDS_PER_DAY;
}

export function configOf(
  surface: PackageSurface,
  kind: string,
): PackageManagerConfig | undefined {
  return surface.configs.find((c) => c.kind === kind);
}

/**
 * Parse a uv `exclude-newer` value. A relative duration ("7 days", "P7D",
 * "24 hours") becomes seconds; an absolute RFC-3339 timestamp is a date pin, so
 * it counts as "present" (configured) but has no comparable age.
 */
export function parseExcludeNewer(value: string): GateValue {
  const v = value.trim();
  if (v === "") return undefined;

  // Absolute timestamp (starts with a 4-digit year) -> configured, unmeasurable.
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "present";

  // ISO-8601 duration: P[nD]T[nH] (weeks via P\d+W).
  const iso = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(v);
  if (iso) {
    const [, w, d, h, m, s] = iso;
    const secs =
      (Number(w ?? 0) * 7 + Number(d ?? 0)) * SECONDS_PER_DAY +
      Number(h ?? 0) * 3600 +
      Number(m ?? 0) * 60 +
      Number(s ?? 0);
    return secs > 0 ? secs : "present";
  }

  // Friendly duration: "<n> <unit>" possibly repeated ("1 week 2 days").
  const unitRe = /(\d+)\s*(week|wk|day|d|hour|hr|h|minute|min|m|second|sec|s)s?/gi;
  let total = 0;
  let matched = false;
  let mm: RegExpExecArray | null;
  while ((mm = unitRe.exec(v)) !== null) {
    matched = true;
    const n = Number(mm[1]);
    const unit = mm[2]!.toLowerCase();
    if (unit.startsWith("w")) total += n * 7 * SECONDS_PER_DAY;
    else if (unit.startsWith("d")) total += n * SECONDS_PER_DAY;
    else if (unit.startsWith("h")) total += n * 3600;
    else if (unit === "m" || unit.startsWith("min")) total += n * 60;
    else total += n;
  }
  if (matched) return total > 0 ? total : "present";
  return "present"; // unknown but non-empty -> treat as configured
}

/** Parse a Bundler `.bundle/config` (YAML map of `BUNDLE_*` keys) for a numeric key. */
export function bundleConfigValue(raw: string, key: string): number | undefined {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*["']?(\\d+)["']?`, "im");
  const m = re.exec(raw);
  return m ? Number(m[1]) : undefined;
}
