import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import type { DependencySpec, Lockfile, Manifest, PackageSurface } from "../model/types.js";
import { parseGoVersion } from "../version/go.js";
import type { EcosystemAdapter } from "./types.js";

export const goAdapter: EcosystemAdapter = {
  ecosystem: "go",
  buildSurfaces(input) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      if (baseOf(file) !== "go.mod") {
        continue;
      }
      const root = dirOf(file);
      const text = input.read(file) ?? "";
      const manifest: Manifest = { path: file, kind: "go.mod", raw: text };

      const lockfiles: Lockfile[] = [];
      const sum = `${root === "." ? "" : `${root}/`}go.sum`;
      if (input.files.includes(sum)) {
        lockfiles.push({ path: sum, kind: "go.sum" });
      }

      surfaces.push({
        ecosystem: "go",
        manager: "go",
        root,
        manifests: [manifest],
        lockfiles,
        configs: [],
        dependencySpecs: parseGoMod(text, file),
        detectedFrom: ["manifest"],
      });
    }
    return surfaces;
  },
};

/** Parse `require` directives out of a go.mod file. */
export function parseGoMod(text: string, manifestPath: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const lines = text.split(/\r?\n/);
  let inBlock = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      return;
    }
    if (inBlock) {
      if (line.startsWith(")")) {
        inBlock = false;
        return;
      }
      pushDep(line, index, manifestPath, specs);
      return;
    }
    const single = /^require\s+(\S+)\s+(\S+)/.exec(line);
    if (single) {
      add(single[1]!, single[2]!, index, manifestPath, specs);
    }
  });

  return specs;
}

function pushDep(line: string, index: number, manifestPath: string, out: DependencySpec[]): void {
  const m = /^(\S+)\s+(\S+)/.exec(line);
  if (m && !line.startsWith("//")) {
    add(m[1]!, m[2]!, index, manifestPath, out);
  }
}

function add(
  name: string,
  version: string,
  index: number,
  manifestPath: string,
  out: DependencySpec[],
): void {
  out.push({
    ecosystem: "go",
    manager: "go",
    manifestPath,
    dependencyName: name,
    rawSpec: version,
    dependencyKind: "dependency",
    parsed: parseGoVersion(version),
    line: index + 1,
  });
}
