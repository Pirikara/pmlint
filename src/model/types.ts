/**
 * Core domain model for pmlint.
 *
 * Rules operate on the normalized {@link RepositoryState}, not on raw files,
 * wherever possible. Adapters are responsible for turning raw files into these
 * normalized shapes.
 */

export type PackageEcosystem = "javascript" | "ruby" | "python" | "go" | "php" | "java";

export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "bundler"
  | "pip"
  | "pip-tools"
  | "poetry"
  | "uv"
  | "go"
  | "composer"
  | "maven"
  | "gradle";

export type ManifestKind =
  | "package.json"
  | "Gemfile"
  | "gemspec"
  | "requirements.txt"
  | "requirements.in"
  | "constraints.txt"
  | "pyproject.toml"
  | "go.mod"
  | "composer.json"
  | "pom.xml"
  | "build.gradle"
  | "build.gradle.kts";

export type LockfileKind =
  | "package-lock.json"
  | "npm-shrinkwrap.json"
  | "pnpm-lock.yaml"
  | "yarn.lock"
  | "bun.lock"
  | "bun.lockb"
  | "Gemfile.lock"
  | "requirements.txt"
  | "poetry.lock"
  | "uv.lock"
  | "pylock.toml"
  | "go.sum"
  | "composer.lock"
  | "gradle.lockfile";

export type PackageManagerConfigKind =
  | ".npmrc"
  | ".yarnrc.yml"
  | "pnpm-workspace.yaml"
  | "bunfig.toml"
  | ".bundle/config"
  | "pyproject.toml"
  | "pip.conf"
  | "pip.ini";

export type DependencyKind =
  | "dependency"
  | "devDependency"
  | "peerDependency"
  | "optionalDependency"
  | "group"
  | "requirement";

export type VersionSpecKind =
  | "exact"
  | "range"
  | "wildcard"
  | "empty"
  | "dist-tag"
  | "unbounded-range"
  | "vcs"
  | "path"
  | "url"
  | "workspace"
  | "unknown";

export type ParsedVersionSpec = {
  kind: VersionSpecKind;
  /** Resolves to an arbitrary future version (e.g. `*`, ``, `latest`). */
  isFloating: boolean;
  /** Has a lower bound but no upper bound (e.g. `>=1.0.0`). */
  isUnbounded: boolean;
  /** For VCS specs: true if pinned to a commit/tag, false if a moving ref, null otherwise. */
  isPinnedVcs: boolean | null;
  /** Dist tag name when {@link kind} is `dist-tag`. */
  distTag?: string;
};

export type Manifest = {
  path: string;
  kind: ManifestKind;
  raw: unknown;
};

export type Lockfile = {
  path: string;
  kind: LockfileKind;
};

export type PackageManagerConfig = {
  path: string;
  kind: PackageManagerConfigKind;
  raw: unknown;
};

export type DependencySpec = {
  ecosystem: PackageEcosystem;
  manager: PackageManager | "unknown";
  manifestPath: string;
  dependencyName: string;
  rawSpec: string;
  dependencyKind: DependencyKind;
  parsed: ParsedVersionSpec;
  /** 1-based line in the manifest where the dependency is declared, if known. */
  line?: number;
};

export type DetectionSource =
  | "packageManagerField"
  | "devEngines"
  | "lockfile"
  | "config"
  | "manifest"
  | "ciCommand";

export type PackageSurface = {
  ecosystem: PackageEcosystem;
  manager: PackageManager | "unknown";
  /** Package root directory, relative to the repository root (e.g. "." or "packages/api"). */
  root: string;
  manifests: Manifest[];
  lockfiles: Lockfile[];
  configs: PackageManagerConfig[];
  dependencySpecs: DependencySpec[];
  detectedFrom: DetectionSource[];
  /**
   * The declared package-manager version string, when the source carried one
   * (e.g. "pnpm@10.16.1" from package.json#packageManager).
   */
  declaredManagerVersion?: string;
};

export type CiInstallCommand = {
  filePath: string;
  line?: number;
  /** The raw command line as written in the workflow. */
  raw: string;
  manager: PackageManager | "unknown";
  /** A mutating install (may rewrite a lockfile/manifest), e.g. `npm install`. */
  isMutatingInstall: boolean;
  /** An update command (e.g. `npm update`, `bundle update`). */
  isUpdate: boolean;
  /** Carries a frozen/locked/deployment signal (e.g. `npm ci`, `--frozen-lockfile`). */
  isFrozen: boolean;
};

export type CiState = {
  /** Absolute or repo-relative paths of detected workflow files. */
  workflowFiles: string[];
  commands: CiInstallCommand[];
};

/** Dependabot per-entry `cooldown` block (delays updates after a release). */
export type DependabotCooldown = {
  defaultDays?: number;
  semverMajorDays?: number;
  semverMinorDays?: number;
  semverPatchDays?: number;
};

export type DependabotUpdateEntry = {
  /** The `package-ecosystem` value as written. */
  packageEcosystem: string;
  /** Normalized directories this entry covers (repo-relative, leading "/" stripped, "." for root). */
  directories: string[];
  /** Parsed `cooldown` block, when present. */
  cooldown?: DependabotCooldown;
};

export type DependabotState = {
  /** Path of the active dependabot config, if present. */
  configPath?: string;
  /** Raw text of the active dependabot config (for structure-preserving fixes). */
  raw?: string;
  /** True when both .yml and .yaml variants exist. */
  duplicate: boolean;
  /** Parsed update entries. Undefined when no config or unparseable. */
  updates?: DependabotUpdateEntry[];
  /** A parse error was encountered. */
  parseError?: boolean;
};

export type RepositoryState = {
  root: string;
  packageSurfaces: PackageSurface[];
  ci: CiState;
  dependabot: DependabotState;
  /** Diagnostics produced during parsing/detection (e.g. parse errors). */
  parseDiagnostics: RuleDiagnostic[];
};

export type Severity = "off" | "warn" | "error";

/**
 * A safe, offline remediation for a diagnostic. Three kinds:
 *  - `replace-line`: substring replacement within a single 1-based line.
 *  - `create`: write a new file (only emitted when the file is absent).
 *  - `delete`: remove a file (always destructive; gated behind an opt-in).
 */
export type FileFix =
  | {
      kind: "replace-line";
      filePath: string;
      line: number;
      find: string;
      replace: string;
      description: string;
      destructive?: false;
    }
  | {
      kind: "create";
      filePath: string;
      content: string;
      description: string;
      destructive?: false;
    }
  | {
      kind: "rewrite";
      filePath: string;
      content: string;
      description: string;
      destructive?: false;
    }
  | {
      kind: "delete";
      filePath: string;
      description: string;
      destructive: true;
    };

export type RuleDiagnostic = {
  ruleId: string;
  severity: "warn" | "error";
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  suggestion?: string;
  /** A safe offline fix, when one exists. */
  fix?: FileFix;
};
