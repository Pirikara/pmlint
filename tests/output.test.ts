import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeReport } from "../src/cli/output.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function scratch(): string {
  const d = mkdtempSync(path.join(tmpdir(), "pmlint-out-"));
  dirs.push(d);
  return d;
}

describe("writeReport", () => {
  it("writes content and returns the absolute path", () => {
    const file = path.join(scratch(), "report.json");
    const abs = writeReport(file, '{"ok":true}');
    expect(abs).toBe(path.resolve(file));
    expect(readFileSync(abs, "utf8")).toBe('{"ok":true}\n');
  });

  it("does not double a trailing newline", () => {
    const file = path.join(scratch(), "r.txt");
    writeReport(file, "line\n");
    expect(readFileSync(file, "utf8")).toBe("line\n");
  });

  it("throws when the directory does not exist", () => {
    expect(() => writeReport("/no/such/dir/report.json", "x")).toThrow();
  });
});
