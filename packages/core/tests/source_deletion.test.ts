import { describe, it, expect } from "vitest";
import { collectDeletions, collectDeletionsFromMeta } from "../src/sources/deletion.js";

describe("collectDeletions", () => {
  it("returns single deletion when one fingerprint disappears", () => {
    const prev = new Set(["a", "b"]);
    const curr = new Set(["a"]);
    const res = collectDeletions(prev, curr, "claude-memory");
    expect(res).toEqual([{ source: "claude-memory", fingerprint: "b" }]);
  });
  it("malformed meta_json returns []", () => {
    const res = collectDeletionsFromMeta("not-json", new Set(["a"]), "claude-memory");
    expect(res).toEqual([]);
  });
  it("empty current returns all purged", () => {
    const prev = new Set(["x", "y"]);
    const curr = new Set<string>();
    const res = collectDeletions(prev, curr, "codex-memories");
    expect(res.length).toBe(2);
  });
  it("no deletions when sets equal", () => {
    const prev = new Set(["a"]);
    const curr = new Set(["a"]);
    expect(collectDeletions(prev, curr, "x")).toEqual([]);
  });
  it("collectDeletionsFromMeta diffs file keys", () => {
    const meta = JSON.stringify({ files: { "a.md": { mtime: 1, size: 2 }, "b.md": { mtime: 2, size: 3 } } });
    const cur = new Set(["a.md"]);
    const res = collectDeletionsFromMeta(meta, cur, "claude-memory");
    expect(res.length).toBe(1);
    expect(res[0].file).toBe("b.md");
  });
});
