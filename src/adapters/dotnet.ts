import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine } from "../fs/parse.js";
import type {
  DependencySpec,
  Lockfile,
  Manifest,
  ManifestKind,
  PackageSurface,
} from "../model/types.js";
import { parseNuGetVersion } from "../version/nuget.js";
import type { EcosystemAdapter } from "./types.js";

const PROJECT_EXTS = /\.(csproj|fsproj|vbproj)$/;

export const dotnetAdapter: EcosystemAdapter = {
  ecosystem: "dotnet",
  buildSurfaces(input) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      const base = baseOf(file);
      if (PROJECT_EXTS.test(base)) {
        surfaces.push(build(input, file, "csproj", parsePackageReferences));
      } else if (base === "Directory.Packages.props") {
        surfaces.push(build(input, file, "Directory.Packages.props", parsePackageVersions));
      } else if (base === "packages.config") {
        surfaces.push(build(input, file, "packages.config", parsePackagesConfig));
      }
    }
    return surfaces;
  },
};

function build(
  input: Discovery,
  file: string,
  kind: ManifestKind,
  parse: (text: string, path: string) => DependencySpec[],
): PackageSurface {
  const root = dirOf(file);
  const text = input.read(file) ?? "";
  const manifest: Manifest = { path: file, kind, raw: text };

  const lockfiles: Lockfile[] = [];
  const lockPath = `${root === "." ? "" : `${root}/`}packages.lock.json`;
  if (input.files.includes(lockPath)) {
    lockfiles.push({ path: lockPath, kind: "packages.lock.json" });
  }

  return {
    ecosystem: "dotnet",
    manager: "nuget",
    root,
    manifests: [manifest],
    lockfiles,
    configs: [],
    dependencySpecs: parse(text, file),
    detectedFrom: ["manifest"],
  };
}

function makeSpec(name: string, version: string, text: string, path: string): DependencySpec {
  return {
    ecosystem: "dotnet",
    manager: "nuget",
    manifestPath: path,
    dependencyName: name,
    rawSpec: version,
    dependencyKind: "dependency",
    parsed: parseNuGetVersion(version),
    line: findLine(text, name),
  };
}

function parsePackageReferences(text: string, path: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const re = /<PackageReference\s+Include="([^"]+)"[^>]*?Version="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    specs.push(makeSpec(m[1]!, m[2]!, text, path));
  }
  return specs;
}

function parsePackageVersions(text: string, path: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const re = /<PackageVersion\s+Include="([^"]+)"[^>]*?Version="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    specs.push(makeSpec(m[1]!, m[2]!, text, path));
  }
  return specs;
}

function parsePackagesConfig(text: string, path: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const re = /<package\s+id="([^"]+)"\s+version="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    specs.push(makeSpec(m[1]!, m[2]!, text, path));
  }
  return specs;
}
