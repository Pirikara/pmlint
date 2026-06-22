import { describe, expect, it } from "vitest";
import { createProgressReporter, type ProgressStream } from "../src/cli/progress.js";

function fakeStream(isTTY: boolean): ProgressStream & { out: string } {
  const s = {
    out: "",
    isTTY,
    write(t: string) {
      s.out += t;
    },
  };
  return s;
}

describe("createProgressReporter", () => {
  it("overwrites in place on a TTY and clears on done", () => {
    const s = fakeStream(true);
    const p = createProgressReporter(true, s);
    p.update("[1/2] a");
    p.update("[2/2] b");
    p.done();
    // Uses carriage returns to overwrite, and clears at the end.
    expect(s.out).toContain("\r");
    expect(s.out).toContain("[2/2] b");
  });

  it("prints plain lines when not a TTY but enabled", () => {
    const s = fakeStream(false);
    const p = createProgressReporter(true, s);
    p.update("[1/2] a");
    p.update("[2/2] b");
    expect(s.out).toBe("[1/2] a\n[2/2] b\n");
  });

  it("is a no-op when disabled", () => {
    const s = fakeStream(true);
    const p = createProgressReporter(false, s);
    p.line("x");
    p.update("y");
    p.done();
    expect(s.out).toBe("");
  });

  it("defaults to off on a non-TTY stream", () => {
    const s = fakeStream(false);
    const p = createProgressReporter(undefined, s);
    p.update("nope");
    expect(s.out).toBe("");
  });
});
