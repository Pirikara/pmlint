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

export type ResolveOptions = {
  /** GitHub org to enumerate via `gh` and add to the targets. */
  org?: string;
  /** Max repos to take from an org listing. */
  limit?: number;
  /** Keep cloned directories instead of cleaning them up. */
  keepClones?: boolean;
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

/** Enumerate an org's repositories via the `gh` CLI. Returns owner/repo specs. */
export function listOrgRepos(org: string, limit = 100): string[] {
  if (!hasCommand("gh")) {
    throw new SourceError("Scanning an org requires the GitHub CLI (`gh`) to be installed and authenticated.");
  }
  try {
    const out = execFileSync(
      "gh",
      ["repo", "list", org, "--limit", String(limit), "--no-archived", "--json", "nameWithOwner", "-q", ".[].nameWithOwner"],
      { encoding: "utf8" },
    );
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (err) {
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
  const specs = [...targets];
  if (options.org) {
    specs.push(...listOrgRepos(options.org, options.limit));
  }

  const repos: ResolvedRepo[] = [];
  const cleanups: Array<() => void> = [];

  for (const spec of specs) {
    if (isLocalDir(spec)) {
      repos.push({ target: spec, root: path.resolve(spec) });
      continue;
    }
    if (isRemoteSpec(spec)) {
      const cloned = cloneSpec(spec);
      repos.push({ target: cloned.target, root: cloned.root, error: cloned.error });
      if (!options.keepClones) {
        cleanups.push(cloned.cleanup);
      }
      continue;
    }
    repos.push({ target: spec, root: spec, error: `not a directory and not a recognized repo spec` });
  }

  return { repos, cleanups };
}
