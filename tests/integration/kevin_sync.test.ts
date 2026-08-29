import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";
import { type OkfEntry, computeEntryId, serialize } from "@jmtrin/kevin-core";

const PLUGIN_REPO_ID = resolve(process.cwd()).repoId;

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-sync-"));
	drops = [];
});

afterEach(() => {
	for (const d of [...drops, tmpRoot]) {
		try {
			rmSync(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
});

function makeMigrationsDir(): string {
	const dir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(dir, { recursive: true });
	const files = [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
		"008_v07_truth.sql",
		"009_v08_team.sql",
	];
	for (const file of files) {
		copyFileSync(join(process.cwd(), "packages/core/migrations", file), join(dir, file));
	}
	return dir;
}

function makeCtx(sess: string): ToolContext {
	return {
		sessionID: sess,
		messageID: "m",
		agent: "test",
		directory: tmpRoot,
		worktree: tmpRoot,
		abort: new AbortController().signal,
		metadata() {},
		ask() {
			return Promise.resolve();
		},
	};
}

async function boot(
	projectRoot: string,
): Promise<Awaited<ReturnType<typeof KevinPlugin>>> {
	return KevinPlugin({ directory: projectRoot } as PluginInput, {
		dbPath: join(tmpRoot, "kevin.db"),
		migrationsDir: makeMigrationsDir(),
		retrospectivesDir: join(tmpRoot, "retrospectives"),
		projectRoot,
	});
}

function entry(statement: string, evidence = 1): OkfEntry {
	return {
		entry_id: computeEntryId("rule", statement, null),
		type: "rule",
		statement,
		scope: null,
		evidence,
		recurrence: 0,
		origin: "pattern",
		author_hash: "3c9ab8d2f7e14a05",
		op: "assert",
		created_at: "2026-08-01T00:00:00Z",
		supersedes: null,
	};
}

function okfPath(projectRoot: string): string {
	return join(projectRoot, ".kevin", "knowledge.okf");
}

function setSetting(dbPath: string, key: string, value: string): void {
	const s = new Store({ path: dbPath });
	s.prepare(
		"INSERT INTO kevin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
	s.close();
}

function importRows(dbPath: string): Array<Record<string, unknown>> {
	const s = new Store({ path: dbPath });
	const rows = s
		.prepare(
			"SELECT file_hash, entries_parsed, skipped FROM okf_imports WHERE repo_id = ? ORDER BY rowid",
		)
		.all(PLUGIN_REPO_ID) as Array<Record<string, unknown>>;
	s.close();
	return rows;
}

async function idle(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	sess: string,
): Promise<void> {
	await hooks.event?.({
		event: { type: "session.idle", properties: { sessionID: sess } } as never,
	});
}

async function runSync(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_sync.execute(
		{} as never,
		makeCtx("sync-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

describe("K8-022 — kevin_sync tool + session.idle wiring (plan §5.5)", () => {
	it("with shared_layer_enabled='0', session.idle performs no filesystem read at all", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		// A path whose read would throw: a directory. With the flag off,
		// no read happens and no okf_imports audit row is written.
		setSetting(dbPath, "okf_path", join(projectRoot, ".kevin"));

		await idle(hooks, "off-sess");
		expect(importRows(dbPath)).toHaveLength(0);
	});

	it("with the flag on and an unchanged file, idle costs one read plus one hash and skips", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		mkdirSync(join(projectRoot, ".kevin"), { recursive: true });
		writeFileSync(
			okfPath(projectRoot),
			serialize([entry("stable rule")], PLUGIN_REPO_ID, "0.8.0"),
		);
		setSetting(dbPath, "shared_layer_enabled", "1");

		const manual = await runSync(hooks);
		expect(manual.skipped).toBe(false);
		expect(manual.parsed).toBe(1);

		await idle(hooks, "on-sess");
		const rows = importRows(dbPath);
		expect(rows).toHaveLength(2);
		expect(rows[1].skipped).toBe(1);
		expect(rows[1].file_hash).toBe(rows[0].file_hash);

		await idle(hooks, "on-sess-2");
		expect(importRows(dbPath)).toHaveLength(3);
	});

	it("kevin_sync invoked manually works regardless of the flag", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		mkdirSync(join(projectRoot, ".kevin"), { recursive: true });
		writeFileSync(
			okfPath(projectRoot),
			serialize(
				[entry("rule one"), entry("rule two")],
				PLUGIN_REPO_ID,
				"0.8.0",
			),
		);

		const res = await runSync(hooks);
		expect(res.skipped).toBe(false);
		expect(res.parsed).toBe(2);
		expect(res.imported).toBe(2);
		expect(res.rejected).toBe(0);
		const s = new Store({ path: dbPath });
		const count = s
			.prepare("SELECT COUNT(*) AS c FROM shared_entries WHERE repo_id = ?")
			.get(PLUGIN_REPO_ID) as { c: number };
		s.close();
		expect(count.c).toBe(2);
	});

	it("shared_entries_imported increments by the number of entries actually upserted", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		mkdirSync(join(projectRoot, ".kevin"), { recursive: true });
		const path = okfPath(projectRoot);
		writeFileSync(
			path,
			serialize([entry("first"), entry("second")], PLUGIN_REPO_ID, "0.8.0"),
		);

		await runSync(hooks);
		writeFileSync(
			path,
			serialize(
				[entry("first"), entry("second"), entry("third")],
				PLUGIN_REPO_ID,
				"0.8.0",
			),
		);
		await runSync(hooks);

		await new Promise((r) => setTimeout(r, 1100));
		const s = new Store({ path: dbPath });
		const row = s
			.prepare(
				"SELECT value AS v FROM kevin_metrics WHERE key = 'shared_entries_imported'",
			)
			.get() as { v: number } | undefined;
		s.close();
		// 2 rows upserted by the first import, 3 by the second (two
		// updates + one insert) — imported counts every row inserted
		// or updated, exactly as the ImportReport documents.
		expect(row?.v ?? 0).toBe(5);
	});

	it("source scan: import() is reachable only from kevin_sync and session.idle", () => {
		const src = readFileSync(join(process.cwd(), "packages/plugin/src", "index.ts"), "utf8");
		const importSites = [...src.matchAll(/sharedLayer\.import\(/g)];
		expect(importSites).toHaveLength(1);
		const syncSites = [...src.matchAll(/syncSharedLayer\(/g)];
		expect(syncSites).toHaveLength(3); // definition + tool + session.idle

		const hotPathKeys = [
			'"tool.execute.before"',
			'"tool.execute.after"',
			'"chat.message"',
			'"experimental.chat.system.transform"',
			'"experimental.session.compacting"',
		];
		for (const key of hotPathKeys) {
			const at = src.indexOf(key);
			expect(at, key).toBeGreaterThan(-1);
			const block = src.slice(at, at + 3000);
			expect(block).not.toContain("sharedLayer");
			expect(block).not.toContain("syncSharedLayer");
		}
	});
});
