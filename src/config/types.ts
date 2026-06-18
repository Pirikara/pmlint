import type { PackageEcosystem, Severity } from "../model/types.js";

export type ProjectType = "app" | "library" | "cli" | "monorepo";

export type PresetName = "recommended" | "app-strict" | "library-recommended";

/** The fully resolved configuration that rules consume. */
export type ResolvedConfig = {
  projectType: ProjectType;
  ecosystems: Record<PackageEcosystem, boolean>;
  ignore: string[];
  failOnWarnings: boolean;
  /** Effective severity for every known rule id. */
  rules: Record<string, Severity>;
  options: {
    /** `js/package-manager-pinned` requires an exact `name@x.y.z` form. */
    requireExactPackageManagerVersion: boolean;
    /** Minimum acceptable release-age gate, in seconds (`js/release-age-gate`). */
    minReleaseAgeSeconds: number;
  };
};

/** The user-authored config file shape (all fields optional). */
export type RawConfig = {
  extends?: string | string[];
  project?: { type?: ProjectType };
  ecosystems?: Partial<Record<PackageEcosystem, { enabled?: boolean }>>;
  lockfile?: { required?: boolean; allowMultipleManagersPerRoot?: boolean };
  install?: { forbidMutatingInstallInCi?: boolean; forbidUpdateCommandsInCi?: boolean };
  dependencies?: {
    forbidFloatingVersions?: boolean;
    forbidDistTags?: boolean;
    forbidUnboundedRanges?: boolean;
    forbidUnpinnedVcsSources?: boolean;
  };
  dependabot?: {
    required?: boolean;
    requireCoverageForAllManifests?: boolean;
    requireGithubActionsUpdates?: boolean;
  };
  registry?: { forbidPlaintextTokens?: boolean; forbidInsecureRegistry?: boolean };
  rules?: Record<string, Severity>;
  ignore?: string[];
  ci?: { failOnWarnings?: boolean };
  requireExactPackageManagerVersion?: boolean;
  minReleaseAgeSeconds?: number;
};
