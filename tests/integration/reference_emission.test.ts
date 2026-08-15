import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../plugin/Store.js";
import { KevinPlugin } from "../../plugin/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let tmpRoot: string;
let root: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>> | undefined;
let dbPath: string;

async function bootPlugin(input: PluginInput): Promise<void> {
	if (hooks) {
		await hooks.dispose?.();
		hooks = undefined;
	}
	const migrationsDir = join(tmpRoot, "m007");
	mkdirSync(migrationsDir, { recursive: true });
	const { copyFile } = await import("node:fs/promises");
	for (const file of [
		"001_initial.sql",
		"003_v02_signal.sql",
		"004_v03_knowledge.sql",
		"005_v04_signal.sql",
		"006_v05_glassbox.sql",
		"007_v06_pull.sql",
	]) {
		await copyFile(
			join(__dirname, "..", "..", "migrations", file),
			join(migrationsDir, file),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	hooks = await KevinPlugin(input, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
		materializerRoot: root,
	});
}

function secondStore(): Store {
	return new Store({ path: dbPath });
}

function seedCuratedMemory(id: string, type: string, content: string): void {
	const s = secondStore();
	s.prepare(
		`INSERT INTO memories (
		  id, type, content, scope, relevance_score, source_tool, source_session,
		  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
		  evidence_count, last_verified_at, status, recurrence_count, ignored,
		  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
		 VALUES (?, ?, ?, 'project', 0.5, NULL, NULL, NULL,
		         datetime('now'), datetime('now'), NULL, NULL, NULL, 'agent',
		         2, datetime('now'), 'active', 0, 0, NULL, 0, 0, 1, NULL, NULL)`,
	).run(id, type, content);
	s.close();
}

function setReferenceEmission(value: string): void {
	const s = secondStore();
	s.prepare(
		"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('reference_emission_enabled', ?)",
	).run(value);
	s.close();
}

function referencesRegistered(): number {
	const s = secondStore();
	const row = s
		.prepare(
			"SELECT value FROM kevin_metrics WHERE key = 'references_registered'",
		)
		.get() as { value: number } | undefined;
	s.close();
	return row?.value ?? 0;
}

function filesUnder(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir);
}

function v2Input(add: (name: string, source: unknown) => unknown): PluginInput {
	return { reference: { add } } as unknown as PluginInput;
}

describe("K6-019 — reference emission @kevin/<topic> (D6-13)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-ref-"));
		root = join(tmpRoot, "opencode-kevin");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (hooks) await hooks.dispose?.();
		hooks = undefined;
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("zero registrations and zero throws on a v1-shaped host, even with the setting '1'", async () => {
		const add = vi.fn();
		await bootPlugin({} as unknown as PluginInput);
		setReferenceEmission("1");
		await bootPlugin({} as unknown as PluginInput);
		expect(hooks).toBeDefined();
		expect(add).not.toHaveBeenCalled();
		expect(referencesRegistered()).toBe(0);
		expect(filesUnder(join(root, "refs"))).toEqual([]);
	});

	it("references_registered equals the number of topic files on a v2-shaped host with the setting '1'", async () => {
		const add = vi.fn().mockReturnValue({ dispose: () => {} });
		await bootPlugin(v2Input(add));
		seedCuratedMemory(
			"mem-npm-1",
			"rule",
			"npm test must pass before any commit",
		);
		seedCuratedMemory(
			"mem-dep-1",
			"decision",
			"deploy to staging after review",
		);
		setReferenceEmission("1");
		await bootPlugin(v2Input(add));
		expect(add).toHaveBeenCalledTimes(2);
		const names = add.mock.calls.map((c) => c[0]);
		expect(names).toEqual(
			expect.arrayContaining(["@kevin/rule-commit", "@kevin/decision-deploy"]),
		);
		for (const call of add.mock.calls) {
			expect(call[1]).toEqual({ local: expect.stringContaining("refs") });
		}
		expect(referencesRegistered()).toBe(2);
		expect(filesUnder(join(root, "refs")).sort()).toEqual(
			expect.arrayContaining(["rule-commit.md", "decision-deploy.md"]),
		);
	});

	it("registering twice in one process does not double the count", async () => {
		const add = vi.fn().mockReturnValue({ dispose: () => {} });
		await bootPlugin(v2Input(add));
		seedCuratedMemory("mem-cargo-1", "rule", "cargo build produces a binary");
		setReferenceEmission("1");
		await bootPlugin(v2Input(add));
		expect(add).toHaveBeenCalledTimes(1);
		expect(referencesRegistered()).toBe(1);
		await bootPlugin(v2Input(add));
		expect(add).toHaveBeenCalledTimes(1);
		expect(referencesRegistered()).toBe(1);
	});

	it("a topic whose file was a 'noop' this cycle is still registered", async () => {
		// Boot 1: registration returns no Registration, so the topic is
		// materialized but NOT marked registered (and not counted).
		const flaky = vi.fn().mockReturnValue({});
		await bootPlugin(v2Input(flaky));
		seedCuratedMemory("mem-tf-1", "rule", "terraform plan shows no changes");
		setReferenceEmission("1");
		await bootPlugin(v2Input(flaky));
		expect(flaky).toHaveBeenCalledTimes(1);
		expect(referencesRegistered()).toBe(0);
		expect(filesUnder(join(root, "refs"))).toEqual(["rule-changes.md"]);
		// Boot 2: the file is byte-identical (noop at the ArtifactWriter),
		// but the topic was never registered — it must be registered now.
		const good = vi.fn().mockReturnValue({ dispose: () => {} });
		await bootPlugin(v2Input(good));
		expect(good).toHaveBeenCalledTimes(1);
		expect(referencesRegistered()).toBe(1);
	});

	it("a host whose registration function throws is caught; the session continues and no metric is incremented", async () => {
		await bootPlugin(
			v2Input(() => {
				throw new Error("registration exploded");
			}),
		);
		seedCuratedMemory(
			"mem-npm-1",
			"rule",
			"npm test must pass before any commit",
		);
		setReferenceEmission("1");
		await bootPlugin(
			v2Input(() => {
				throw new Error("registration exploded");
			}),
		);
		expect(hooks).toBeDefined();
		expect(referencesRegistered()).toBe(0);
	});
});
