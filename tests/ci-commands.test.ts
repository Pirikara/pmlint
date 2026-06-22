import { describe, expect, it } from "vitest";
import { classifyCommand } from "../src/ci/workflows.js";
import type { PackageManager } from "../src/model/types.js";

type Expected = {
  manager: PackageManager;
  mutating?: boolean;
  update?: boolean;
  frozen?: boolean;
};

// command -> expected classification (undefined = not a relevant command)
const CASES: Array<[string, Expected | null]> = [
  // npm
  ["npm install", { manager: "npm", mutating: true }],
  ["npm ci", { manager: "npm", frozen: true }],
  ["npm update", { manager: "npm", update: true }],
  // pnpm
  ["pnpm install", { manager: "pnpm", mutating: true }],
  ["pnpm install --frozen-lockfile", { manager: "pnpm", frozen: true }],
  ["pnpm update", { manager: "pnpm", update: true }],
  // yarn
  ["yarn install", { manager: "yarn", mutating: true }],
  ["yarn install --immutable", { manager: "yarn", frozen: true }],
  ["yarn up", { manager: "yarn", update: true }],
  // bun
  ["bun install", { manager: "bun", mutating: true }],
  ["bun install --frozen-lockfile", { manager: "bun", frozen: true }],
  // bundler
  ["bundle install", { manager: "bundler", mutating: true }],
  ["bundle install --deployment", { manager: "bundler", frozen: true }],
  ["bundle update", { manager: "bundler", update: true }],
  // pip
  ["pip install -r requirements.txt", { manager: "pip", mutating: true }],
  ["pip install --require-hashes -r requirements.txt", { manager: "pip", frozen: true }],
  ["pip install --upgrade requests", { manager: "pip", update: true }],
  // poetry / uv
  ["poetry update", { manager: "poetry", update: true }],
  ["uv sync", { manager: "uv", mutating: true }],
  ["uv sync --locked", { manager: "uv", frozen: true }],
  ["uv lock --upgrade", { manager: "uv", update: true }],
  // go
  ["go mod tidy", { manager: "go", mutating: true }],
  ["go get -u ./...", { manager: "go", update: true }],
  ["go mod download", { manager: "go", frozen: true }],
  // composer
  ["composer install", { manager: "composer", frozen: true }],
  ["composer update", { manager: "composer", update: true }],
  // cargo
  ["cargo update", { manager: "cargo", update: true }],
  // dart / flutter
  ["dart pub get", { manager: "pub", mutating: true }],
  ["flutter pub upgrade", { manager: "pub", update: true }],
  // swift
  ["swift package update", { manager: "swift", update: true }],
  ["swift package resolve", { manager: "swift", frozen: true }],
  // elixir
  ["mix deps.get", { manager: "hex", mutating: true }],
  ["mix deps.update --all", { manager: "hex", update: true }],
  // not relevant
  ["echo hello", null],
  ["yarn test", null],
];

describe("classifyCommand", () => {
  it.each(CASES)("classifies %s", (cmd, expected) => {
    const result = classifyCommand(cmd);
    if (expected === null) {
      expect(result).toBeNull();
      return;
    }
    expect(result).not.toBeNull();
    expect(result?.manager).toBe(expected.manager);
    expect(result?.isMutatingInstall).toBe(expected.mutating ?? false);
    expect(result?.isUpdate).toBe(expected.update ?? false);
    expect(result?.isFrozen).toBe(expected.frozen ?? false);
  });

  it("treats a file-level Bundler frozen signal as frozen", () => {
    expect(classifyCommand("bundle install", true)?.isFrozen).toBe(true);
  });
});
