import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CausalChain } from "../../plugin/CausalChain.js";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

const migrationsDir = join(process.cwd(), "migrations");

describe("K11-004 CausalChain ms-aware", () => {
	let store: Store;
	let ms: MemoryService;
	beforeEach(async () => {
		store = new Store({ path: ":memory:" });
		await new Migrate(store, migrationsDir).run();
		ms = new MemoryService(store, null);
	});
	afterEach(() => {
		store.close();
	});

	it("fix occurring 800ms after failure links when using _ms", () => {
		const fp = "fp-ms-1";
		// create error memory
		const memId = ms.save({
			type: "error",
			content: "boom",
			fingerprint: fp,
			origin: "reflector",
			scope: "project",
		});
		// need project scoping? memory fingerprint
		const baseMs = Date.now();
		const failMs = baseMs;
		const successMs = baseMs + 800;
		const legacyTs = new Date(baseMs)
			.toISOString()
			.replace("T", " ")
			.slice(0, 19);
		// failure
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, ts_ms, tool, success, fingerprint, error_fingerprint)
				 VALUES (?, ?, ?, ?, 'bash', 0, ?, ?)`,
			)
			.run("fail-1", "sess-ms", legacyTs, failMs, fp, fp);
		// success 800ms later, same legacy second (so string tie)
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, ts_ms, tool, args_summary, success)
				 VALUES (?, ?, ?, ?, 'bash', 'fix it', 1)`,
			)
			.run("succ-1", "sess-ms", legacyTs, successMs);

		const chain = new CausalChain(store, ms, null);
		chain.onSuccess("bash", {}, null, "sess-ms");

		const linked = store
			.prepare("SELECT fix_for_fingerprint FROM tool_calls WHERE id = ?")
			.get("succ-1") as { fix_for_fingerprint: string | null } | undefined;
		expect(linked?.fix_for_fingerprint).toBe(fp);
	});

	it("same fixture with columns nulled falls back to legacy and still links", () => {
		const fp = "fp-legacy-1";
		ms.save({
			type: "error",
			content: "boom2",
			fingerprint: fp,
			origin: "reflector",
			scope: "project",
		});
		// Insert without ms columns (null)
		const legacyTs = new Date(Date.now() - 1000)
			.toISOString()
			.replace("T", " ")
			.slice(0, 19);
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, success, fingerprint, error_fingerprint)
				 VALUES (?, ?, ?, 'bash', 0, ?, ?)`,
			)
			.run("fail-2", "sess-legacy", legacyTs, fp, fp);
		store
			.prepare(
				`INSERT INTO tool_calls (id, session_id, ts, tool, args_summary, success)
				 VALUES (?, ?, ?, 'bash', 'fix', 1)`,
			)
			.run("succ-2", "sess-legacy", legacyTs);

		// Null out ts_ms to simulate pre-migration (ensure columns are null)
		store.prepare("UPDATE tool_calls SET ts_ms = NULL").run();

		const chain = new CausalChain(store, ms, null);
		chain.onSuccess("bash", {}, null, "sess-legacy");

		const linked = store
			.prepare("SELECT fix_for_fingerprint FROM tool_calls WHERE id = ?")
			.get("succ-2") as { fix_for_fingerprint: string | null } | undefined;
		expect(linked?.fix_for_fingerprint).toBe(fp);
	});
});
