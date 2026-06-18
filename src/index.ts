#!/usr/bin/env node
import { cac } from "cac";
import { runCheck, runExplain, type OutputFormat } from "./cli/check.js";
import { runInit } from "./cli/init.js";
import { VERSION } from "./version.js";

function main(argv: string[]): void {
  const cli = cac("pmlint");

  cli
    .command("check [target]", "Lint package-manager policy")
    .option("--config <path>", "Path to a pmlint config file (authoritative; skips repo-local config)")
    .option("--no-repo-config", "Ignore any repo-local pmlint.yml (audit/fleet mode)")
    .option("--fix", "Apply safe offline fixes to the working tree")
    .option("--fix-dry-run", "Print the fix plan without writing anything")
    .option("--fix-destructive", "Allow destructive fixes (e.g. deleting a foreign lockfile)")
    .option("--format <format>", "Output format: stylish | json", { default: "stylish" })
    .option("--no-color", "Disable colored output")
    .action((target: string | undefined, options: Record<string, unknown>) => {
      const outcome = runCheck({
        target,
        config: options.config as string | undefined,
        noRepoConfig: options.repoConfig === false,
        fix: options.fix === true,
        fixDryRun: options.fixDryRun === true,
        fixDestructive: options.fixDestructive === true,
        format: options.format as OutputFormat,
        color: process.stdout.isTTY && options.color !== false,
      });
      emit(outcome);
    });

  cli
    .command("explain [target]", "Print detected dependency surfaces without failing")
    .option("--config <path>", "Path to a pmlint config file (authoritative; skips repo-local config)")
    .option("--no-repo-config", "Ignore any repo-local pmlint.yml (audit/fleet mode)")
    .action((target: string | undefined, options: Record<string, unknown>) => {
      const outcome = runExplain({
        target,
        config: options.config as string | undefined,
        noRepoConfig: options.repoConfig === false,
      });
      emit(outcome);
    });

  cli
    .command("init", "Create a starter pmlint.yml")
    .action(() => {
      const result = runInit(process.cwd());
      if (result.created) {
        process.stdout.write(`Created ${result.path}\n`);
      } else {
        process.stdout.write(`${result.path} already exists; not overwriting.\n`);
      }
      process.exitCode = 0;
    });

  cli.help();
  cli.version(VERSION);

  // Default to `check .` when no command is given but a path/flags are present.
  if (argv.length <= 2) {
    cli.outputHelp();
    process.exitCode = 0;
    return;
  }

  try {
    cli.parse(argv, { run: false });
    if (cli.matchedCommand) {
      cli.runMatchedCommand();
    } else if (!hasMetaFlag(argv)) {
      cli.outputHelp();
    }
  } catch (err) {
    process.stderr.write(`pmlint: ${(err as Error).message}\n`);
    process.exitCode = 2;
  }
}

function hasMetaFlag(argv: string[]): boolean {
  return argv.some((a) => a === "-h" || a === "--help" || a === "-v" || a === "--version");
}

function emit(outcome: { stdout: string; stderr?: string; exitCode: number }): void {
  if (outcome.stdout) {
    process.stdout.write(outcome.stdout.endsWith("\n") ? outcome.stdout : `${outcome.stdout}\n`);
  }
  if (outcome.stderr) {
    process.stderr.write(`pmlint: ${outcome.stderr}\n`);
  }
  process.exitCode = outcome.exitCode;
}

main(process.argv);
