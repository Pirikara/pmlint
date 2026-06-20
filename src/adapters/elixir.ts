import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine } from "../fs/parse.js";
import type { DependencySpec, Lockfile, Manifest, PackageSurface, ParsedVersionSpec } from "../model/types.js";
import { parseHexConstraint } from "../version/hex.js";
import type { EcosystemAdapter } from "./types.js";

export const elixirAdapter: EcosystemAdapter = {
  ecosystem: "elixir",
  buildSurfaces(input) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      if (baseOf(file) !== "mix.exs") {
        continue;
      }
      const root = dirOf(file);
      const text = input.read(file) ?? "";
      const manifest: Manifest = { path: file, kind: "mix.exs", raw: text };

      const lockfiles: Lockfile[] = [];
      const lockPath = `${root === "." ? "" : `${root}/`}mix.lock`;
      if (input.files.includes(lockPath)) {
        lockfiles.push({ path: lockPath, kind: "mix.lock" });
      }

      surfaces.push({
        ecosystem: "elixir",
        manager: "hex",
        root,
        manifests: [manifest],
        lockfiles,
        configs: [],
        dependencySpecs: parseMixExs(text, file),
        detectedFrom: ["manifest"],
      });
    }
    return surfaces;
  },
};

/** Extract dependency tuples from the `deps` function of a mix.exs. */
export function parseMixExs(text: string, manifestPath: string): DependencySpec[] {
  const block = /defp?\s+deps\b[\s\S]*?\n\s*end\b/.exec(text)?.[0] ?? text;
  const specs: DependencySpec[] = [];
  const re = /\{\s*:([A-Za-z_]\w*)\s*,\s*([^{}]*)\}/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(block)) !== null) {
    const name = m[1]!;
    const rest = m[2]!.trim();
    const parsed = classifyMixDep(rest);
    if (!parsed) {
      continue;
    }
    // For a plain version dep, show the unquoted constraint rather than the
    // raw tuple body (which still has the surrounding quotes).
    const version = /^"([^"]+)"/.exec(rest)?.[1];
    specs.push({
      ecosystem: "elixir",
      manager: "hex",
      manifestPath,
      dependencyName: name,
      rawSpec: version ?? rest,
      dependencyKind: "dependency",
      parsed,
      line: findLine(text, `:${name},`) ?? findLine(text, `:${name}`),
    });
  }
  return specs;
}

function classifyMixDep(rest: string): ParsedVersionSpec | null {
  if (/\b(git|github):\s*"/.test(rest)) {
    const pinned = /\b(tag|ref):\s*"/.test(rest);
    return { kind: "vcs", isFloating: false, isUnbounded: false, isPinnedVcs: pinned };
  }
  if (/\bpath:\s*"/.test(rest)) {
    return { kind: "path", isFloating: false, isUnbounded: false, isPinnedVcs: null };
  }
  const version = /^"([^"]+)"/.exec(rest)?.[1];
  if (version !== undefined) {
    return parseHexConstraint(version);
  }
  return null; // not a dependency tuple (no version or source)
}
