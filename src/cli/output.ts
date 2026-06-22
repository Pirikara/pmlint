import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Write a report string to `outputPath`, ensuring a trailing newline.
 * Returns the absolute path written. Throws on I/O failure.
 */
export function writeReport(outputPath: string, content: string): string {
  const abs = path.resolve(outputPath);
  const text = content.endsWith("\n") ? content : `${content}\n`;
  writeFileSync(abs, text, "utf8");
  return abs;
}
