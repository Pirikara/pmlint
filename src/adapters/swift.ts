import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import type { DependencySpec, Lockfile, Manifest, PackageSurface, ParsedVersionSpec } from "../model/types.js";
import type { EcosystemAdapter } from "./types.js";

export const swiftAdapter: EcosystemAdapter = {
  ecosystem: "swift",
  buildSurfaces(input) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      if (baseOf(file) !== "Package.swift") {
        continue;
      }
      const root = dirOf(file);
      const text = input.read(file) ?? "";
      const manifest: Manifest = { path: file, kind: "Package.swift", raw: text };

      const lockfiles: Lockfile[] = [];
      const lockPath = `${root === "." ? "" : `${root}/`}Package.resolved`;
      if (input.files.includes(lockPath)) {
        lockfiles.push({ path: lockPath, kind: "Package.resolved" });
      }

      surfaces.push({
        ecosystem: "swift",
        manager: "swift",
        root,
        manifests: [manifest],
        lockfiles,
        configs: [],
        dependencySpecs: parsePackageSwift(text, file),
        detectedFrom: ["manifest"],
      });
    }
    return surfaces;
  },
};

/** Extract `.package(...)` dependency declarations from a Package.swift. */
export function parsePackageSwift(text: string, manifestPath: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const marker = ".package(";
  let i = 0;
  while ((i = text.indexOf(marker, i)) !== -1) {
    const open = i + marker.length - 1; // index of '('
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const content = text.slice(open + 1, j);
    const dep = classifyPackage(content);
    if (dep) {
      specs.push({
        ecosystem: "swift",
        manager: "swift",
        manifestPath,
        dependencyName: dep.name,
        rawSpec: content.replace(/\s+/g, " ").trim(),
        dependencyKind: "dependency",
        parsed: dep.parsed,
        line: lineAt(text, i),
      });
    }
    i = j + 1;
  }
  return specs;
}

function classifyPackage(content: string): { name: string; parsed: ParsedVersionSpec } | null {
  const url = /url:\s*"([^"]+)"/.exec(content)?.[1];
  const pathDep = /path:\s*"([^"]+)"/.exec(content)?.[1];
  const named = /(?:name|id):\s*"([^"]+)"/.exec(content)?.[1];

  const name = url ? repoName(url) : pathDep ? pathDep : named ?? "package";

  if (pathDep && !url) {
    return { name, parsed: spec("path") };
  }
  if (/\brevision:\s*"/.test(content)) {
    return { name, parsed: vcs(true) };
  }
  if (/\bbranch:\s*"/.test(content)) {
    return { name, parsed: vcs(false) };
  }
  if (/\bexact:\s*"/.test(content) || /\.exact\(/.test(content)) {
    return { name, parsed: spec("exact") };
  }
  if (
    /\bfrom:\s*"/.test(content) ||
    /\.upToNextMajor\(/.test(content) ||
    /\.upToNextMinor\(/.test(content) ||
    /"\d[^"]*"\s*\.\.[.<]/.test(content)
  ) {
    return { name, parsed: spec("range") };
  }
  if (url) {
    return { name, parsed: spec("unknown") };
  }
  return null;
}

function repoName(url: string): string {
  const last = url.replace(/\.git$/, "").split("/").filter(Boolean).pop();
  return last ?? url;
}

function spec(kind: ParsedVersionSpec["kind"]): ParsedVersionSpec {
  return { kind, isFloating: false, isUnbounded: false, isPinnedVcs: null };
}

function vcs(pinned: boolean): ParsedVersionSpec {
  return { kind: "vcs", isFloating: false, isUnbounded: false, isPinnedVcs: pinned };
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index; k++) {
    if (text.charCodeAt(k) === 10) line++;
  }
  return line;
}
