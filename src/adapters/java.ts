import type { Discovery } from "../fs/discovery.js";
import { baseOf, dirOf } from "../fs/discovery.js";
import { findLine } from "../fs/parse.js";
import type { DependencySpec, Lockfile, Manifest, PackageSurface } from "../model/types.js";
import { parseGradleVersion, parseMavenVersion } from "../version/java.js";
import type { EcosystemAdapter } from "./types.js";

export const javaAdapter: EcosystemAdapter = {
  ecosystem: "java",
  buildSurfaces(input) {
    const surfaces: PackageSurface[] = [];
    for (const file of input.files) {
      const base = baseOf(file);
      if (base === "pom.xml") {
        surfaces.push(buildMaven(input, file));
      } else if (base === "build.gradle" || base === "build.gradle.kts") {
        surfaces.push(buildGradle(input, file, base));
      }
    }
    return surfaces;
  },
};

function buildMaven(input: Discovery, file: string): PackageSurface {
  const text = input.read(file) ?? "";
  const manifest: Manifest = { path: file, kind: "pom.xml", raw: text };
  return {
    ecosystem: "java",
    manager: "maven",
    root: dirOf(file),
    manifests: [manifest],
    lockfiles: [], // Maven has no standard lockfile
    configs: [],
    dependencySpecs: parsePom(text, file),
    detectedFrom: ["manifest"],
  };
}

function buildGradle(input: Discovery, file: string, base: string): PackageSurface {
  const root = dirOf(file);
  const text = input.read(file) ?? "";
  const manifest: Manifest = {
    path: file,
    kind: base === "build.gradle.kts" ? "build.gradle.kts" : "build.gradle",
    raw: text,
  };

  const lockfiles: Lockfile[] = [];
  const prefix = root === "." ? "" : `${root}/`;
  const lockPath = `${prefix}gradle.lockfile`;
  const hasLockDir = input.files.some((f) => f.startsWith(`${prefix}gradle/dependency-locks/`));
  if (input.files.includes(lockPath)) {
    lockfiles.push({ path: lockPath, kind: "gradle.lockfile" });
  } else if (hasLockDir) {
    const lock = input.files.find((f) => f.startsWith(`${prefix}gradle/dependency-locks/`))!;
    lockfiles.push({ path: lock, kind: "gradle.lockfile" });
  }

  return {
    ecosystem: "java",
    manager: "gradle",
    root,
    manifests: [manifest],
    lockfiles,
    configs: [],
    dependencySpecs: parseGradle(text, file),
    detectedFrom: ["manifest"],
  };
}

/** Extract `<dependency>` versions from a pom.xml (regex-based, resolves simple props). */
export function parsePom(text: string, manifestPath: string): DependencySpec[] {
  const props = readMavenProperties(text);
  const specs: DependencySpec[] = [];
  const depBlocks = text.match(/<dependency>[\s\S]*?<\/dependency>/g) ?? [];

  for (const block of depBlocks) {
    const groupId = tag(block, "groupId");
    const artifactId = tag(block, "artifactId");
    const rawVersion = tag(block, "version");
    if (!artifactId || rawVersion === undefined) {
      continue; // version managed elsewhere (parent/BOM)
    }
    const resolved = resolveProps(rawVersion, props);
    const name = groupId ? `${groupId}:${artifactId}` : artifactId;
    specs.push({
      ecosystem: "java",
      manager: "maven",
      manifestPath,
      dependencyName: name,
      rawSpec: rawVersion,
      dependencyKind: "dependency",
      parsed: parseMavenVersion(resolved),
      line: findLine(text, `<artifactId>${artifactId}</artifactId>`),
    });
  }
  return specs;
}

/** Extract `group:artifact:version` dependencies from a build.gradle(.kts). */
export function parseGradle(text: string, manifestPath: string): DependencySpec[] {
  const specs: DependencySpec[] = [];
  const seen = new Set<string>();
  // Quoted "group:artifact:version" coordinates (string-notation deps).
  const re = /['"]([\w.-]+:[\w.-]+:[^:'"\s]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const coord = m[1]!;
    if (seen.has(coord)) {
      continue;
    }
    seen.add(coord);
    const parts = coord.split(":");
    if (parts.length < 3) {
      continue;
    }
    const name = `${parts[0]}:${parts[1]}`;
    const version = parts[2]!;
    specs.push({
      ecosystem: "java",
      manager: "gradle",
      manifestPath,
      dependencyName: name,
      rawSpec: version,
      dependencyKind: "dependency",
      parsed: parseGradleVersion(version),
      line: findLine(text, coord),
    });
  }
  return specs;
}

function readMavenProperties(text: string): Record<string, string> {
  const props: Record<string, string> = {};
  const block = /<properties>([\s\S]*?)<\/properties>/.exec(text)?.[1];
  if (!block) {
    return props;
  }
  const re = /<([\w.-]+)>([^<]*)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    props[m[1]!] = m[2]!.trim();
  }
  return props;
}

function resolveProps(value: string, props: Record<string, string>): string {
  return value.replace(/\$\{([\w.-]+)\}/g, (full, name: string) => props[name] ?? full);
}

function tag(block: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  return m ? m[1]!.trim() : undefined;
}
