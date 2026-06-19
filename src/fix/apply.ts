import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FileFix, RuleDiagnostic } from "../model/types.js";

export type FixOptions = {
  /** Apply destructive fixes (e.g. deleting a foreign lockfile). */
  destructive?: boolean;
};

export type FixReport = {
  applied: FileFix[];
  /** Destructive fixes withheld because `destructive` was not enabled. */
  skippedDestructive: FileFix[];
};

/** Collect the unique fixes carried by a set of diagnostics. */
export function collectFixes(diagnostics: RuleDiagnostic[]): FileFix[] {
  const seen = new Set<string>();
  const fixes: FileFix[] = [];
  for (const diag of diagnostics) {
    if (!diag.fix) {
      continue;
    }
    const key = fixKey(diag.fix);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    fixes.push(diag.fix);
  }
  return fixes;
}

/** Apply fixes to the working tree under `root`. */
export function applyFixes(
  root: string,
  diagnostics: RuleDiagnostic[],
  options: FixOptions = {},
): FixReport {
  const fixes = collectFixes(diagnostics);
  const applied: FileFix[] = [];
  const skippedDestructive: FileFix[] = [];

  // Group replace-line edits per file so multiple edits compose on one write.
  const lineEditsByFile = new Map<string, Array<{ line: number; find: string; replace: string }>>();

  for (const fix of fixes) {
    if (fix.kind === "delete") {
      if (!options.destructive) {
        skippedDestructive.push(fix);
        continue;
      }
      const abs = path.join(root, fix.filePath);
      if (existsSync(abs)) {
        rmSync(abs);
      }
      applied.push(fix);
    } else if (fix.kind === "create") {
      const abs = path.join(root, fix.filePath);
      if (existsSync(abs)) {
        continue; // never clobber an existing file
      }
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, fix.content, "utf8");
      applied.push(fix);
    } else if (fix.kind === "rewrite") {
      const abs = path.join(root, fix.filePath);
      if (!existsSync(abs)) {
        continue; // rewrite only applies to an existing file
      }
      writeFileSync(abs, fix.content, "utf8");
      applied.push(fix);
    } else {
      const list = lineEditsByFile.get(fix.filePath) ?? [];
      list.push({ line: fix.line, find: fix.find, replace: fix.replace });
      lineEditsByFile.set(fix.filePath, list);
      applied.push(fix);
    }
  }

  for (const [filePath, edits] of lineEditsByFile) {
    const abs = path.join(root, filePath);
    if (!existsSync(abs)) {
      continue;
    }
    const original = readFileSync(abs, "utf8");
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.split(/\r?\n/);
    for (const edit of edits) {
      const idx = edit.line - 1;
      if (idx >= 0 && idx < lines.length) {
        lines[idx] = lines[idx]!.replace(edit.find, edit.replace);
      }
    }
    writeFileSync(abs, lines.join(eol), "utf8");
  }

  return { applied, skippedDestructive };
}

/** Render a human-readable plan of the fixes without touching disk. */
export function planFixes(
  root: string,
  diagnostics: RuleDiagnostic[],
  options: FixOptions = {},
): string {
  const fixes = collectFixes(diagnostics);
  if (fixes.length === 0) {
    return "No auto-fixable issues found.";
  }

  const lines: string[] = ["pmlint --fix (dry run)", ""];
  for (const fix of fixes) {
    switch (fix.kind) {
      case "replace-line":
        lines.push(`edit   ${fix.filePath}:${fix.line}`);
        lines.push(`       - ${fix.find}`);
        lines.push(`       + ${fix.replace}`);
        break;
      case "create":
      case "rewrite":
        lines.push(`${fix.kind === "create" ? "create" : "rewrite"} ${fix.filePath}`);
        for (const contentLine of fix.content.replace(/\n$/, "").split("\n")) {
          lines.push(`       | ${contentLine}`);
        }
        break;
      case "delete":
        lines.push(
          options.destructive
            ? `delete ${fix.filePath} (destructive)`
            : `delete ${fix.filePath} (destructive — skipped; pass --fix-destructive)`,
        );
        break;
    }
    lines.push("");
  }
  return lines.join("\n");
}

function fixKey(fix: FileFix): string {
  switch (fix.kind) {
    case "replace-line":
      return `replace:${fix.filePath}:${fix.line}:${fix.find}:${fix.replace}`;
    case "create":
      return `create:${fix.filePath}`;
    case "rewrite":
      return `rewrite:${fix.filePath}`;
    case "delete":
      return `delete:${fix.filePath}`;
  }
}
