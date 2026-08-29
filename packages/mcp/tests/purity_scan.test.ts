import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "node:http",
  "node:https",
  "node:net",
  "node:dgram",
  "fetch(",
  "XMLHttpRequest",
  "SSETransport",
  "HttpTransport",
  "child_process",
  "spawn",
  "console.log(",
];
const SRC = join(process.cwd(), "packages/mcp/src");
function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}
describe("K14-013 purity scan", () => {
  it("src contains no forbidden strings", () => {
    const violations: string[] = [];
    for (const file of walk(SRC)) {
      const content = readFileSync(file, "utf8");
      for (const pat of FORBIDDEN) {
        if (content.includes(pat)) {
          // allow spawn in tests comment? no
          violations.push(`${file}:${pat}`);
        }
      }
    }
    expect(violations, `forbidden strings found: ${violations.join(", ")}`).toEqual([]);
  });
});
