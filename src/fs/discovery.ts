import { readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";

export const DEFAULT_IGNORED_DIRS = [
  ".git",
  "node_modules",
  "vendor/bundle",
  // NB: do not ignore ".bundle" — it holds Bundler's `config` (frozen/cooldown
  // settings) that pmlint needs to read. Vendored gems live in vendor/bundle.
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "coverage",
];

/** Glob patterns for every file kind pmlint inspects. */
const FILE_PATTERNS = [
  // JavaScript
  "**/package.json",
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/.npmrc",
  "**/.yarnrc.yml",
  "**/.yarnrc.yaml",
  "**/pnpm-workspace.yaml",
  "**/bunfig.toml",
  // Ruby
  "**/Gemfile",
  "**/*.gemspec",
  "**/Gemfile.lock",
  "**/.bundle/config",
  // Python
  "**/pyproject.toml",
  "**/requirements*.txt",
  "**/requirements*.in",
  "**/constraints.txt",
  "**/poetry.lock",
  "**/uv.lock",
  "**/pylock.toml",
  "**/pip.conf",
  "**/pip.ini",
  "**/poetry.toml",
  "**/uv.toml",
  // Go
  "**/go.mod",
  "**/go.sum",
  // PHP / Composer
  "**/composer.json",
  "**/composer.lock",
  // Java (Maven / Gradle)
  "**/pom.xml",
  "**/build.gradle",
  "**/build.gradle.kts",
  "**/settings.gradle",
  "**/settings.gradle.kts",
  "**/gradle.lockfile",
  "**/gradle/dependency-locks/*.lockfile",
  // Rust / Cargo
  "**/Cargo.toml",
  "**/Cargo.lock",
  // .NET / NuGet
  "**/*.csproj",
  "**/*.fsproj",
  "**/*.vbproj",
  "**/packages.config",
  "**/Directory.Packages.props",
  "**/packages.lock.json",
  // Dart / Flutter (pub)
  "**/pubspec.yaml",
  "**/pubspec.lock",
  // Swift (SPM)
  "**/Package.swift",
  "**/Package.resolved",
  // Elixir (Hex / Mix)
  "**/mix.exs",
  "**/mix.lock",
  // CI + Dependabot
  ".github/workflows/*.yml",
  ".github/workflows/*.yaml",
  ".github/dependabot.yml",
  ".github/dependabot.yaml",
];

export type Discovery = {
  root: string;
  /** Repo-relative POSIX paths of all discovered files. */
  files: string[];
  /** Read a discovered file's text; returns undefined on error. */
  read(relPath: string): string | undefined;
};

export function discover(root: string, ignore: string[] = []): Discovery {
  const ignorePatterns = [
    ...DEFAULT_IGNORED_DIRS.map((d) => `**/${d}/**`),
    ...ignore,
  ];

  const files = fg
    .sync(FILE_PATTERNS, {
      cwd: root,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: ignorePatterns,
      suppressErrors: true,
    })
    .sort();

  const cache = new Map<string, string | undefined>();
  const read = (relPath: string): string | undefined => {
    if (cache.has(relPath)) {
      return cache.get(relPath);
    }
    let content: string | undefined;
    try {
      content = readFileSync(path.join(root, relPath), "utf8");
    } catch {
      content = undefined;
    }
    cache.set(relPath, content);
    return content;
  };

  return { root, files, read };
}

/** The directory of a repo-relative file, as a POSIX path ("." for root). */
export function dirOf(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "" ? "." : dir;
}

/** The basename of a repo-relative file. */
export function baseOf(relPath: string): string {
  return path.posix.basename(relPath);
}
