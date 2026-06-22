import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ResolvedRepo } from "./types.js";

/**
 * The sources layer is the ONLY place that touches the network / spawns
 * processes. It turns target specs (local paths, repo URLs, owner/repo, or an
 * org) into local directories for the (offline) engine to scan.
 */

export type ResolveProgress =
  | { phase: "enumerating"; org: string }
  | { phase: "resolving"; done: number; total: number; spec: string; cloned: boolean };

export type ResolveOptions = {
  /** GitHub org to enumerate via `gh` and add to the targets. */
  org?: string;
  /** Max repos to take from an org listing. */
  limit?: number;
  /** Keep cloned directories instead of cleaning them up. */
  keepClones?: boolean;
  /** Progress callback (clone/resolve phase). */
  onProgress?: (p: ResolveProgress) => void;
};

export type ResolveResult = {
  repos: ResolvedRepo[];
  /** Cleanup callbacks for any temporary clones. */
  cleanups: Array<() => void>;
};

export class SourceError extends Error {
  override readonly name = "SourceError";
}

function hasCommand(cmd: string): boolean {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isLocalDir(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Looks like a clone-able remote spec (URL or owner/repo). */
function isRemoteSpec(target: string): boolean {
  return (
    /^https?:\/\//.test(target) ||
    /^git@/.test(target) ||
    /^ssh:\/\//.test(target) ||
    /^[\w.-]+\/[\w.-]+$/.test(target)
  );
}

function cloneUrl(spec: string): string {
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(spec)) {
    return spec;
  }
  // owner/repo shorthand -> GitHub HTTPS.
  return `https://github.com/${spec}.git`;
}

/**
 * Build the `gh` argv to list an org's non-archived repos.
 *
 * - `limit <= 0` ("all"): page through every repo via the REST API
 *   (`gh api --paginate`), which has no cap.
 * - `limit > 0`: `gh repo list --limit N` (gh paginates internally up to N).
 */
export function orgReposCommand(org: string, limit: number): string[] {
  if (limit <= 0) {
    return [
      "api",
      "--paginate",
      `orgs/${org}/repos?per_page=100&type=all`,
      "--jq",
      ".[] | select(.archived == false) | .full_name",
    ];
  }
  return [
    "repo",
    "list",
    org,
    "--limit",
    String(limit),
    "--no-archived",
    "--json",
    "nameWithOwner",
    "-q",
    ".[].nameWithOwner",
  ];
}

/** Enumerate an org's repositories via the `gh` CLI. Returns owner/repo specs.
 *  `limit` defaults to 0 = all (paginated). */
export function listOrgRepos(org: string, limit = 0): string[] {
  if (!hasCommand("gh")) {
    throw new SourceError("Scanning an org requires the GitHub CLI (`gh`) to be installed and authenticated.");
  }
  const run = (args: string[]): string[] => {
    const out = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  };

  try {
    return run(orgReposCommand(org, limit));
  } catch (err) {
    // The REST org endpoint 404s for a user account; fall back to `gh repo
    // list`, which works for both users and orgs (capped at a high limit).
    if (limit <= 0) {
      try {
        return run(orgReposCommand(org, 100000));
      } catch {
        /* fall through to the original error */
      }
    }
    throw new SourceError(`Failed to list repos for org "${org}": ${(err as Error).message}`);
  }
}

function cloneSpec(spec: string): ResolvedRepo & { cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "pmlint-scan-"));
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  const preferGh = hasCommand("gh") && /^[\w.-]+\/[\w.-]+$/.test(spec);
  try {
    if (preferGh) {
      execFileSync("gh", ["repo", "clone", spec, dir, "--", "--depth", "1"], { stdio: "ignore" });
    } else {
      execFileSync("git", ["clone", "--depth", "1", cloneUrl(spec), dir], { stdio: "ignore" });
    }
    return { target: spec, root: dir, cleanup };
  } catch (err) {
    cleanup();
    return { target: spec, root: dir, error: `clone failed: ${(err as Error).message}`, cleanup: () => {} };
  }
}

/** Resolve all targets (plus any org enumeration) into local directories. */
export function resolveTargets(targets: string[], options: ResolveOptions = {}): ResolveResult {
  const report = options.onProgress ?? (() => {});
  const specs = [...targets];
  if (options.org) {
    report({ phase: "enumerating", org: options.org });
    specs.push(...listOrgRepos(options.org, options.limit));
  }

  const repos: ResolvedRepo[] = [];
  const cleanups: Array<() => void> = [];
  const total = specs.length;

  specs.forEach((spec, i) => {
    let cloned = false;
    if (isLocalDir(spec)) {
      repos.push({ target: spec, root: path.resolve(spec) });
    } else if (isRemoteSpec(spec)) {
      cloned = true;
      const result = cloneSpec(spec);
      repos.push({ target: result.target, root: result.root, error: result.error });
      if (!options.keepClones) {
        cleanups.push(result.cleanup);
      }
    } else {
      repos.push({ target: spec, root: spec, error: `not a directory and not a recognized repo spec` });
    }
    report({ phase: "resolving", done: i + 1, total, spec, cloned });
  });

  return { repos, cleanups };
}
