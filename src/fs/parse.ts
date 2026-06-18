import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseTomlText } from "smol-toml";
import { parse as parseYamlText } from "yaml";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseJsonSafe<T = unknown>(text: string): ParseResult<T> {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return { ok: false, error: "Invalid JSON" };
  }
  return { ok: true, value: value as T };
}

export function parseYamlSafe<T = unknown>(text: string): ParseResult<T> {
  try {
    return { ok: true, value: parseYamlText(text) as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function parseTomlSafe<T = unknown>(text: string): ParseResult<T> {
  try {
    return { ok: true, value: parseTomlText(text) as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Best-effort 1-based line lookup for a substring (used for diagnostics).
 * Returns undefined when not found.
 */
export function findLine(text: string, needle: string): number | undefined {
  const idx = text.indexOf(needle);
  if (idx === -1) {
    return undefined;
  }
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}
