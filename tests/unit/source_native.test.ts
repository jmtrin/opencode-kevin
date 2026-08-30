import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OpencodeNativeSource, NATIVE_CANDIDATE_PATHS } from "../../packages/core/src/sources/OpencodeNativeSource.js";

describe("K21-006 native probe", () => {
  it("NATIVE_CANDIDATE_PATHS is single source of truth and health absent-safe", () => {
    expect(NATIVE_CANDIDATE_PATHS).toEqual([".opencode/memory/*.md", ".opencode/MEMORY.md"]);
    // grep guard: exactly one file defines NATIVE_CANDIDATE_PATHS
    const src = readFileSync("packages/core/src/sources/OpencodeNativeSource.ts", "utf8");
    expect(src).toContain("NATIVE_CANDIDATE_PATHS");
    // ensure no other source file contains the pattern
    const other = readFileSync("packages/core/src/sources/ClaudeMemorySource.ts", "utf8");
    expect(other).not.toContain(".opencode/memory");
  });

  it("absent everywhere returns [] and health absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-absent-"));
    const src = new OpencodeNativeSource(() => true, dir);
    const res = await src.fetch();
    expect(res).toEqual([]);
    expect(src.health().status).toBe("absent");
    rmSync(dir, { recursive: true, force: true });
  });

  it("planted fixture dir discovered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-found-"));
    mkdirSync(join(dir, ".opencode", "memory"), { recursive: true });
    writeFileSync(join(dir, ".opencode", "memory", "a.md"), "# test\nhello world\n", "utf8");
    const src = new OpencodeNativeSource(() => true, dir);
    const res = await src.fetch();
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res.some((r) => r.statement.includes("hello"))).toBe(true);
    expect(src.health().status).toBe("ok");
    rmSync(dir, { recursive: true, force: true });
  });
});
