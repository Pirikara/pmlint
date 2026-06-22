/**
 * A small stderr progress reporter for `scan`. Writes to stderr so it never
 * pollutes the report on stdout (or a `--output` file). On a TTY it overwrites
 * a single line in place; otherwise it prints plain lines (useful in CI logs).
 */
export type ProgressReporter = {
  /** A standalone status line (e.g. "Enumerating…"). */
  line(text: string): void;
  /** An updating progress line (overwrites in place on a TTY). */
  update(text: string): void;
  /** Finish: clear the in-place line (TTY) and stop. */
  done(): void;
};

export type ProgressStream = {
  write(s: string): void;
  isTTY?: boolean;
};

const NOOP: ProgressReporter = { line() {}, update() {}, done() {} };

export function createProgressReporter(
  enabled?: boolean,
  stream: ProgressStream = process.stderr,
): ProgressReporter {
  const on = enabled ?? Boolean(stream.isTTY);
  if (!on) {
    // In non-interactive runs, still surface plain lines so logs show life,
    // but only when progress is explicitly enabled.
    if (enabled !== true) {
      return NOOP;
    }
  }

  const isTTY = Boolean(stream.isTTY);
  let dirty = false;
  let lastLen = 0;

  const clear = () => {
    if (isTTY && dirty) {
      stream.write(`\r${" ".repeat(lastLen)}\r`);
      dirty = false;
      lastLen = 0;
    }
  };

  return {
    line(text: string): void {
      clear();
      stream.write(`${text}\n`);
    },
    update(text: string): void {
      if (isTTY) {
        const padded = text.length < lastLen ? text + " ".repeat(lastLen - text.length) : text;
        stream.write(`\r${padded}`);
        dirty = true;
        lastLen = text.length;
      } else {
        stream.write(`${text}\n`);
      }
    },
    done(): void {
      clear();
    },
  };
}
