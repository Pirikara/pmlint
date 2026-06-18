import type { Discovery } from "../fs/discovery.js";
import type { PackageEcosystem, PackageSurface, RuleDiagnostic } from "../model/types.js";

export type AddDiagnostic = (diag: RuleDiagnostic) => void;

export type EcosystemAdapter = {
  ecosystem: PackageEcosystem;
  /** Build normalized package surfaces from discovered files. */
  buildSurfaces(input: Discovery, addDiag: AddDiagnostic): PackageSurface[];
};
