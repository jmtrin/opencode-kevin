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
import { resolve } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { fnv1a64 } from "@jmtrin/kevin-core";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeHost } from "../../packages/plugin/src/host.js";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

let tmpRoot: string;
let drops: string[] = [];

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-share-"));
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
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
			join(dir, file),
		);
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

// The session identity is per-project (v2.2.0 K22-004 / plan §4.4, D22-03):
// replicate the factory exactly (probeHost + resolve against the instance
// directory) so seeds land under the id the session is scoped on — never
// the server cwd.
async function sessionIds(
	projectRoot: string,
): Promise<{ repoId: string; projectId: string }> {
	const host = await probeHost({ directory: projectRoot } as PluginInput);
	const identity = resolve(projectRoot, host);
	return { repoId: identity.repoId, projectId: identity.projectId };
}

async function seedMemory(
	dbPath: string,
	projectRoot: string,
	opts: {
		id: string;
		content: string;
		evidence?: number;
		curated?: number;
	} = { id: "mem-1", content: "share me", evidence: 3 },
): Promise<void> {
	const ids = await sessionIds(projectRoot);
	const s = new Store({ path: dbPath });
	s.prepare(
		`INSERT INTO memories
		 (id, type, content, scope, relevance_score, project_id,
		  evidence_count, recurrence_count, created_at, updated_at,
		  status, curated, inferable, origin, layer, repo_id)
		 VALUES (?, 'rule', ?, 'project', 0.3, ?, ?, 0, datetime('now'),
		  datetime('now'), 'active', ?, 1, 'pattern', 'local', ?)`,
	).run(
		opts.id,
		opts.content,
		ids.projectId,
		opts.evidence ?? 3,
		opts.curated ?? 1,
		ids.repoId,
	);
	s.close();
}

async function runShare(
	hooks: Awaited<ReturnType<typeof KevinPlugin>>,
	args: { memory_ids?: string[]; dry_run?: boolean; confirm?: boolean },
): Promise<Record<string, unknown>> {
	const r = await hooks.tool?.kevin_share.execute(
		args as never,
		makeCtx("share-sess"),
	);
	return JSON.parse((r as { output: string }).output) as Record<
		string,
		unknown
	>;
}

function okfPath(projectRoot: string): string {
	return join(projectRoot, ".kevin", "knowledge.okf");
}

function expectMissing(path: string): void {
	expect(() => readFileSync(path, "utf8")).toThrow();
}

describe("K8-021 — kevin_share (plan §5.5)", () => {
	it("default invocation writes nothing and returns a diff", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "default dry run rule",
		});

		const res = await runShare(hooks, {});
		expect(res.dry_run).toBe(true);
		expect(res.entries_added).toBe(1);
		expect(res.diff).toBeTypeOf("string");
		expect((res.diff as string).length).toBeGreaterThan(0);
		expectMissing(okfPath(projectRoot));
	});

	it("confirm: true writes through the ArtifactWriter funnel and no other path", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "confirmed share rule",
		});

		const res = await runShare(hooks, { dry_run: false, confirm: true });
		expect(res.outcome).toBe("written");
		expect(res.entries_added).toBe(1);
		const text = readFileSync(okfPath(projectRoot), "utf8");
		expect(text).toContain("#okf 2");
		expect(text).toContain("confirmed share rule");

		// The write went through the writer: an audit row exists.
		const s = new Store({ path: dbPath });
		const row = s
			.prepare("SELECT COUNT(*) AS c FROM artifact_writes WHERE path = ?")
			.get(okfPath(projectRoot)) as { c: number };
		s.close();
		expect(row.c).toBe(1);
	});

	it("an un-curated memory is refused with not_curated when approval is required", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "uncurated rule",
			curated: 0,
		});

		const res = await runShare(hooks, { memory_ids: ["mem-1"] });
		expect(res.refused).toBe("not_curated");
		expectMissing(okfPath(projectRoot));
	});

	it("a memory below shared_confidence_floor is refused with below_floor", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "weak rule",
			evidence: 0,
		});

		const res = await runShare(hooks, { memory_ids: ["mem-1"] });
		expect(res.refused).toBe("below_floor");
		expectMissing(okfPath(projectRoot));
	});

	it("BUG-006: a typo'd or foreign memory id is refused with unknown_entry, never silently dropped", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "valid rule",
		});

		const bogus = await runShare(hooks, {
			memory_ids: ["mem-1", "no-such-id"],
		});
		expect(bogus.refused).toBe("unknown_entry");
		expectMissing(okfPath(projectRoot));

		const onlyBogus = await runShare(hooks, {
			memory_ids: ["no-such-id"],
		});
		expect(onlyBogus.refused).toBe("unknown_entry");
		expectMissing(okfPath(projectRoot));
	});

	it("sharing the same memory twice is a noop on the second attempt", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "noop rule",
		});

		const first = await runShare(hooks, { dry_run: false, confirm: true });
		expect(first.outcome).toBe("written");
		const hashAfterFirst = fnv1a64(readFileSync(okfPath(projectRoot), "utf8"));

		const second = await runShare(hooks, { dry_run: false, confirm: true });
		expect(second.outcome).toBe("noop");
		expect(second.entries_added).toBe(0);
		expect(fnv1a64(readFileSync(okfPath(projectRoot), "utf8"))).toBe(
			hashAfterFirst,
		);
	});

	it("with no memory_ids, only curated memories at or above the floor are selected", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "weak",
			content: "weak rule",
			evidence: 0,
		});
		await seedMemory(dbPath, projectRoot, {
			id: "strong",
			content: "strong rule",
			evidence: 4,
		});

		const res = await runShare(hooks, {});
		const ids = res.memory_ids as string[];
		expect(ids).toEqual(["strong"]);
		expect(res.entries_added).toBe(1);
	});

	it("confirm is required to write when share_requires_approval is '1'", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "gated rule",
		});

		const res = await runShare(hooks, { dry_run: false });
		expect(res.confirm_required).toBe(true);
		expectMissing(okfPath(projectRoot));
	});

	it("shared_entries_exported matches the number of new lines in the file", async () => {
		const projectRoot = mkdtempSync(join(tmpRoot, "proj"));
		drops.push(projectRoot);
		const dbPath = join(tmpRoot, "kevin.db");
		const hooks = await boot(projectRoot);
		await seedMemory(dbPath, projectRoot, {
			id: "mem-1",
			content: "counted rule",
		});
		await seedMemory(dbPath, projectRoot, {
			id: "mem-2",
			content: "counted rule two",
		});

		const res = await runShare(hooks, { dry_run: false, confirm: true });
		expect(res.outcome).toBe("written");
		expect(res.entries_added).toBe(2);
		const newLines = readFileSync(okfPath(projectRoot), "utf8")
			.split("\n")
			.filter((l) => l.startsWith("{")).length;
		expect(newLines).toBe(2);

		// The metric increments by the entries actually added; a noop
		// share does not move it. The Metrics debounce flushes after 1 s.
		await new Promise((r) => setTimeout(r, 1100));
		const s = new Store({ path: dbPath });
		const row = s
			.prepare(
				"SELECT value AS v FROM kevin_metrics WHERE key = 'shared_entries_exported'",
			)
			.get() as { v: number } | undefined;
		s.close();
		expect(row?.v ?? 0).toBe(2);
	});
});
