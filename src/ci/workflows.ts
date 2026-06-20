import type { Discovery } from "../fs/discovery.js";
import { parseYamlSafe } from "../fs/parse.js";
import type {
  ActionReference,
  CiInstallCommand,
  CiState,
  PackageManager,
} from "../model/types.js";
import type { AddDiagnostic } from "../adapters/types.js";

/**
 * Extract package-manager install/update commands from GitHub Actions
 * workflows. Detection is string/regex based (MVP scope).
 */
export function extractCiState(input: Discovery, addDiag: AddDiagnostic): CiState {
  const workflowFiles = input.files.filter((f) =>
    /^\.github\/workflows\/.+\.(ya?ml)$/.test(f),
  );

  const commands: CiInstallCommand[] = [];
  const actions: ActionReference[] = [];

  for (const file of workflowFiles) {
    const text = input.read(file);
    if (text === undefined) {
      continue;
    }
    const parsed = parseYamlSafe(text);
    if (!parsed.ok) {
      addDiag({
        ruleId: "config/parse-error",
        severity: "error",
        message: "Could not parse workflow YAML.",
        filePath: file,
      });
      continue;
    }

    for (const value of collectUses(parsed.value)) {
      actions.push(classifyUses(value, file, text));
    }

    // File-level frozen signal for Bundler (env var or `bundle config`).
    const fileHasBundlerFrozen =
      /BUNDLE_FROZEN\s*[:=]\s*["']?(true|1)/.test(text) ||
      /bundle\s+config\s+(set\s+)?(--global\s+|--local\s+)?(frozen|deployment)\s+true/.test(text);

    const runs = collectRunStrings(parsed.value);
    for (const run of runs) {
      for (const { command, line } of splitCommands(run.value, run.startLine, text)) {
        const classified = classifyCommand(command, fileHasBundlerFrozen);
        if (classified) {
          commands.push({ filePath: file, line, raw: command, ...classified });
        }
      }
    }
  }

  return { workflowFiles, commands, actions };
}

/** Recursively collect all `uses:` step values from a parsed workflow. */
function collectUses(node: unknown): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (key === "uses" && typeof v === "string") {
          out.push(v);
        } else {
          visit(v);
        }
      }
    }
  };
  visit(node);
  return out;
}

function classifyUses(raw: string, filePath: string, fileText: string): ActionReference {
  const value = raw.trim();
  const isLocal = value.startsWith("./") || value.startsWith("../") || value.startsWith(".");
  const at = value.lastIndexOf("@");
  const ref = at >= 0 ? value.slice(at + 1) : undefined;
  const isPinned =
    ref !== undefined && (/^[0-9a-f]{40}$/.test(ref) || /^[0-9a-f]{64}$/.test(ref) || ref.startsWith("sha256:"));
  return { filePath, line: locateLine(fileText, value), raw: value, ref, isPinned, isLocal };
}

type RunString = { value: string; startLine: number };

/** Recursively collect all `run:` step values from a parsed workflow. */
function collectRunStrings(node: unknown): RunString[] {
  const out: RunString[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
    } else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (key === "run" && typeof v === "string") {
          out.push({ value: v, startLine: 0 });
        } else {
          visit(v);
        }
      }
    }
  };
  visit(node);
  return out;
}

type CommandLine = { command: string; line?: number };

/** Split a (possibly multiline) run script into individual commands. */
function splitCommands(run: string, _startLine: number, fileText: string): CommandLine[] {
  const out: CommandLine[] = [];
  const physicalLines = run.split(/\r?\n/);
  for (const physical of physicalLines) {
    // Split chained commands on &&, ;, and |.
    const parts = physical.split(/&&|;|\|\|/);
    for (const part of parts) {
      const command = part.trim().replace(/\\$/, "").trim();
      if (command === "") {
        continue;
      }
      out.push({ command, line: locateLine(fileText, command) });
    }
  }
  return out;
}

function locateLine(fileText: string, command: string): number | undefined {
  const idx = fileText.indexOf(command);
  if (idx === -1) {
    return undefined;
  }
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (fileText.charCodeAt(i) === 10) line++;
  }
  return line;
}

type Classification = {
  manager: PackageManager | "unknown";
  isMutatingInstall: boolean;
  isUpdate: boolean;
  isFrozen: boolean;
};

/** Classify a single shell command. Returns null if it is not relevant. */
export function classifyCommand(
  raw: string,
  fileHasBundlerFrozen = false,
): Classification | null {
  const c = raw.trim().replace(/^(sudo|env\s+\S+=\S+)\s+/, "");

  // --- npm ---
  if (/^npm\s+ci\b/.test(c)) return mk("npm", { frozen: true });
  if (/^npm\s+update\b/.test(c)) return mk("npm", { update: true });
  if (/^npm\s+(install|i|add)\b/.test(c)) return mk("npm", { mutating: true });

  // --- pnpm ---
  if (/^pnpm\s+update\b/.test(c)) return mk("pnpm", { update: true });
  if (/^pnpm\s+(install|i)\b/.test(c) || /^pnpm\s*$/.test(c)) {
    const frozen = /--frozen-lockfile\b/.test(c) && !/--no-frozen-lockfile\b/.test(c);
    return mk("pnpm", { mutating: !frozen, frozen });
  }
  if (/^pnpm\s+add\b/.test(c)) return mk("pnpm", { mutating: true });

  // --- yarn ---
  const ym = /^yarn(?:\s+(.*))?$/.exec(c);
  if (ym) {
    const args = (ym[1] ?? "").trim();
    const first = args.split(/\s+/)[0] ?? "";
    if (first === "up" || first === "upgrade") return mk("yarn", { update: true });
    if (first === "add") return mk("yarn", { mutating: true });
    if (first === "" || first.startsWith("-") || first === "install") {
      const frozen =
        /(--immutable|--frozen-lockfile)\b/.test(c) && !/--no-immutable\b/.test(c);
      return mk("yarn", { mutating: !frozen, frozen });
    }
    return null; // `yarn <script>`
  }

  // --- bun ---
  if (/^bun\s+ci\b/.test(c)) return mk("bun", { frozen: true });
  if (/^bun\s+update\b/.test(c)) return mk("bun", { update: true });
  if (/^bun\s+(install|i)\b/.test(c)) {
    const frozen = /--frozen-lockfile\b/.test(c);
    return mk("bun", { mutating: !frozen, frozen });
  }
  if (/^bun\s+add\b/.test(c)) return mk("bun", { mutating: true });

  // --- bundler ---
  if (/^bundle\s+update\b/.test(c)) return mk("bundler", { update: true });
  if (/^bundle\s+(install|_install_)\b/.test(c) || /^bundle\s+install\b/.test(c)) {
    const frozen =
      /--deployment\b/.test(c) || /--frozen\b/.test(c) || fileHasBundlerFrozen;
    return mk("bundler", { mutating: !frozen, frozen });
  }

  // --- pip / pip-tools ---
  if (/(^|\s)pip(3)?\s+install\b.*(--upgrade|\s-U\b)/.test(c)) {
    return mk("pip", { update: true });
  }
  if (/pip-compile\b.*--upgrade/.test(c)) return mk("pip-tools", { update: true });
  if (/(^|\s)pip(3)?\s+install\b.*-r\b/.test(c) || /python(3)?\s+-m\s+pip\s+install\b.*-r\b/.test(c)) {
    const frozen = /--require-hashes\b/.test(c);
    return mk("pip", { mutating: !frozen, frozen });
  }

  // --- poetry ---
  if (/^poetry\s+update\b/.test(c)) return mk("poetry", { update: true });
  if (/^poetry\s+install\b/.test(c)) {
    // poetry install is deterministic against poetry.lock by default.
    return mk("poetry", { frozen: true });
  }

  // --- uv ---
  if (/^uv\s+lock\b.*--upgrade/.test(c)) return mk("uv", { update: true });
  if (/^uv\s+sync\b/.test(c)) {
    const frozen = /--locked\b/.test(c) || /--frozen\b/.test(c);
    return mk("uv", { mutating: !frozen, frozen });
  }

  // --- go modules ---
  if (/^go\s+get\b.*-u\b/.test(c)) return mk("go", { update: true });
  if (/^go\s+get\b/.test(c)) return mk("go", { mutating: true });
  if (/^go\s+mod\s+tidy\b/.test(c)) return mk("go", { mutating: true });
  if (/^go\s+mod\s+download\b/.test(c)) return mk("go", { frozen: true });

  // --- composer ---
  if (/^composer\s+update\b/.test(c)) return mk("composer", { update: true });
  if (/^composer\s+require\b/.test(c)) return mk("composer", { mutating: true });
  if (/^composer\s+install\b/.test(c)) return mk("composer", { frozen: true });

  // --- cargo ---
  if (/^cargo\s+update\b/.test(c)) return mk("cargo", { update: true });

  // --- dart / flutter pub ---
  if (/^(dart|flutter)\s+pub\s+upgrade\b/.test(c)) return mk("pub", { update: true });
  if (/^(dart|flutter)\s+pub\s+get\b/.test(c)) {
    const frozen = /--enforce-lockfile\b/.test(c);
    return mk("pub", { mutating: !frozen, frozen });
  }

  // --- swift / SPM ---
  if (/^swift\s+package\s+update\b/.test(c)) return mk("swift", { update: true });
  if (/^swift\s+package\s+resolve\b/.test(c)) return mk("swift", { frozen: true });

  // --- elixir / mix (hex) ---
  if (/^mix\s+deps\.update\b/.test(c)) return mk("hex", { update: true });
  if (/^mix\s+deps\.get\b/.test(c)) {
    const frozen = /--check-locked\b/.test(c);
    return mk("hex", { mutating: !frozen, frozen });
  }

  return null;
}

function mk(
  manager: PackageManager,
  flags: { mutating?: boolean; update?: boolean; frozen?: boolean },
): Classification {
  return {
    manager,
    isMutatingInstall: flags.mutating ?? false,
    isUpdate: flags.update ?? false,
    isFrozen: flags.frozen ?? false,
  };
}
