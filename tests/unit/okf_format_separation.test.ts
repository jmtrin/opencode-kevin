import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { exportOkf } from "@jmtrin/kevin-core";
import { importOkf } from "@jmtrin/kevin-core";
import { parse, serialize } from "@jmtrin/kevin-core";

/**
 * K8-027 / plan §5.3 — the two formats are mutually unintelligible and
 * structurally disconnected: the v1 bundle (markdown frontmatter) is not
 * a v2 file, the v2 file is not a v1 bundle, and no module of one format
 * may import a module of the other.
 */
describe("K8-027 — OKF v1/v2 format separation", () => {
	it("okf.parse(exportOkf(...)) returns zero entries and rejects as not_okf", async () => {
		const store = new Store({ path: ":memory:" });
		for (const file of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
		]) {
			store.exec(readFileSync(join(process.cwd(), "packages/core/migrations", file), "utf8"));
		}
		const service = new MemoryService(store);
		service.save({
			type: "rule",
			content: "v1 rule that must never be a v2 entry",
			scope: "project",
			projectId: "proj-a",
			evidenceCount: 2,
		});

		const v1 = exportOkf(store, "proj-a");
		const parsed = parse(v1);

		expect(parsed.entries).toEqual([]);
		expect(parsed.rejected.length).toBeGreaterThan(0);
		expect(parsed.rejected[0].reason).toBe("not_okf");
		store.close();
	});

	it("importOkf(okf.serialize(...)) finds no v1 bundle structure", async () => {
		const store = new Store({ path: ":memory:" });
		for (const file of [
			"001_initial.sql",
			"003_v02_signal.sql",
			"004_v03_knowledge.sql",
			"005_v04_signal.sql",
		]) {
			store.exec(readFileSync(join(process.cwd(), "packages/core/migrations", file), "utf8"));
		}
		const service = new MemoryService(store);

		const v2 = serialize(
			[
				{
					entry_id: "aaaaaaaaaaaaaaaa",
					type: "rule",
					statement: "v2 rule that must never be a v1 entry",
					scope: "project",
					evidence: 2,
					recurrence: 0,
					origin: "pattern",
					author_hash: null,
					op: "assert",
					created_at: "2026-08-18T00:00:00Z",
					supersedes: null,
				},
			],
			"2114ad162af50a25",
			"0.8.0",
		);

		const result = importOkf(v2, service);
		expect(result.imported).toBe(0);
		expect(result.superseded).toBe(0);
		expect(service.getById("aaaaaaaaaaaaaaaa")).toBeNull();
		store.close();
	});

	it("a source scan proves no import edge between okf.ts and the v1 modules", () => {
		const read = (f: string): string =>
			readFileSync(join(process.cwd(), "packages/core/src", f), "utf8");
		const okfSrc = read("okf.ts");
		const exportSrc = read("okf-export.ts");
		const importSrc = read("okf-import.ts");

		expect(okfSrc).not.toMatch(/from "\.\/okf-export\.js"/);
		expect(okfSrc).not.toMatch(/from "\.\/okf-import\.js"/);
		expect(exportSrc).not.toMatch(/from "\.\/okf\.js"/);
		expect(importSrc).not.toMatch(/from "\.\/okf\.js"/);
	});

	it("a source scan proves importOkf has exactly one call site, unreachable from kevin_sync", () => {
		// v1.3.0 Bedrock: core is hostless, so kevin_import lives in the plugin adapter.
		// Scan both core and plugin src; exactly one call site expected in plugin.
		const scanDirs = ["packages/core/src", "packages/plugin/src"];
		const callSites: string[] = [];
		for (const dir of scanDirs) {
			const files = readdirSync(join(process.cwd(), dir)).filter((f) => f.endsWith(".ts"));
			for (const f of files) {
				const src = readFileSync(join(process.cwd(), dir, f), "utf8");
				for (const line of src.split(/\r?\n/)) {
					if (
						/\bimportOkf\(/.test(line) &&
						!line.includes("export function importOkf")
					) {
						callSites.push(`${dir}/${f}: ${line.trim()}`);
					}
				}
			}
		}
		expect(callSites).toHaveLength(1);
		expect(callSites[0]).toContain("index.ts");
		// The one call site is the kevin_import tool — kevin_sync lives in
		// the shared layer (SharedLayer.import) and must not reach v1.
		expect(callSites[0]).not.toMatch(/kevin_sync|syncSharedLayer/);
	});
});
