import type { ResolvedConfig } from "../config/types.js";
import type { FileFix, RepositoryState } from "../model/types.js";
import type { RuleId } from "./ids.js";

/** A rule finding, without the ruleId/severity (the engine attaches those). */
export type Finding = {
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  suggestion?: string;
  /** A safe offline fix for this finding, when one exists. */
  fix?: FileFix;
};

export type RuleContext = {
  state: RepositoryState;
  config: ResolvedConfig;
};

export type Rule = {
  id: RuleId;
  check(ctx: RuleContext): Finding[];
};
