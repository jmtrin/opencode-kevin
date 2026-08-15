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

function seedCuratedMemory(): void {
	const s = secondStore();
	s.prepare(
		"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('skill_emission_enabled', ?)",
	).run("1");
	s.prepare(
		`INSERT INTO memories (
		  id, type, content, scope, relevance_score, source_tool, source_session,
		  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
		  evidence_count, last_verified_at, status, recurrence_count, ignored,
		  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
		 VALUES (?, 'rule', ?, 'project', 0.5, NULL, NULL, NULL,
		         datetime('now'), datetime('now'), NULL, NULL, NULL, 'agent',
		         2, datetime('now'), 'active', 0, 0, NULL, 0, 0, 1, NULL, NULL)`,
	).run("mem-skill-1", "npm test must pass before any commit");
	s.close();
}

function setSkillEmission(value: string): void {
	const s = secondStore();
	s.prepare(
		"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('skill_emission_enabled', ?)",
	).run(value);
	s.close();
}

function skillsRegistered(): number {
	const s = secondStore();
	const row = s
		.prepare("SELECT value FROM kevin_metrics WHERE key = 'skills_registered'")
		.get() as { value: number } | undefined;
	s.close();
	return row?.value ?? 0;
}

function filesUnder(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir);
}

function v2Input(source: (body: string) => unknown): PluginInput {
	return { skill: { source } } as unknown as PluginInput;
}

describe("K6-018 — skill emission behind skill_emission_enabled (D6-13)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-skill-"));
		root = join(tmpRoot, "opencode-kevin");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (hooks) await hooks.dispose?.();
		hooks = undefined;
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("on a v1-shaped host, session start produces no warning, no throw, and no file under skills/", async () => {
		await bootPlugin({} as unknown as PluginInput);
		expect(hooks).toBeDefined();
		seedCuratedMemory();
		// emission ran at init before the seed; a second construct would
		// re-run it — assert the init itself produced nothing on disk.
		expect(filesUnder(join(root, "skills"))).toEqual([]);
		expect(filesUnder(join(root, "refs"))).toEqual([]);
		expect(skillsRegistered()).toBe(0);
	});

	it("on a v2-shaped host with skill_emission_enabled = '0', nothing is registered", async () => {
		const source = vi.fn().mockReturnValue({ dispose: () => {} });
		await bootPlugin(v2Input(source));
		seedCuratedMemory();
		setSkillEmission("0");
		// Boot again with the same store so the gate sees '0'.
		await bootPlugin(v2Input(source));
		expect(source).not.toHaveBeenCalled();
		expect(skillsRegistered()).toBe(0);
		expect(filesUnder(join(root, "skills"))).toEqual([]);
	});

	it("on a v2-shaped host with skill_emission_enabled = '1', exactly one Skill is registered and skills_registered is 1", async () => {
		await bootPlugin(v2Input(() => ({ dispose: () => {} })));
		seedCuratedMemory();
		const source = vi.fn().mockReturnValue({ dispose: () => {} });
		await bootPlugin(v2Input(source));
		expect(source).toHaveBeenCalledTimes(1);
		expect(String(source.mock.calls[0][0])).toContain("npm test");
		expect(skillsRegistered()).toBe(1);
		expect(filesUnder(join(root, "skills"))).toContain("project-knowledge.md");
	});

	it("a host whose registration function throws is caught; the session continues and no metric is incremented", async () => {
		await bootPlugin(
			v2Input(() => {
				throw new Error("registration exploded");
			}),
		);
		seedCuratedMemory();
		await bootPlugin(
			v2Input(() => {
				throw new Error("registration exploded");
			}),
		);
		expect(hooks).toBeDefined();
		expect(skillsRegistered()).toBe(0);
	});

	it("with no curated memories, nothing is registered even when enabled and capable", async () => {
		const source = vi.fn().mockReturnValue({ dispose: () => {} });
		await bootPlugin(v2Input(source));
		setSkillEmission("1");
		await bootPlugin(v2Input(source));
		expect(source).not.toHaveBeenCalled();
		expect(skillsRegistered()).toBe(0);
		expect(filesUnder(join(root, "skills"))).toEqual([]);
	});
});
