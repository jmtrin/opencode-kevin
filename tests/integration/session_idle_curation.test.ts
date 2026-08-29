import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Archiver } from "@jmtrin/kevin-core";
import { Curator } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let tmpRoot: string;
let hooks: Awaited<ReturnType<typeof KevinPlugin>> | undefined;
let dbPath: string;

async function bootPlugin(): Promise<void> {
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
			join(__dirname, "..", "..", "packages/core/migrations", file),
			join(migrationsDir, file),
		);
	}
	dbPath = join(tmpRoot, "kevin.db");
	hooks = await KevinPlugin({ directory: tmpRoot } as PluginInput, {
		dbPath,
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	});
}

function secondStore(): Store {
	return new Store({ path: dbPath });
}

function seed(overrides: { curationEnabled?: string } = {}): void {
	const s = secondStore();
	s.prepare(
		"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('agents_md_path', ?)",
	).run(join(tmpRoot, "AGENTS.md"));
	if (overrides.curationEnabled !== undefined) {
		s.prepare(
			"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('curation_enabled', ?)",
		).run(overrides.curationEnabled);
	}
	s.prepare(
		`INSERT INTO memories (
		  id, type, content, scope, relevance_score, source_tool, source_session,
		  metadata, created_at, updated_at, expires_at, project_id, fingerprint, origin,
		  evidence_count, last_verified_at, status, recurrence_count, ignored,
		  superseded_by, feedback_positive, feedback_negative, curated, curated_at, inferable)
		 VALUES (?, 'rule', ?, 'project', 0.5, NULL, NULL, NULL,
		         datetime('now'), datetime('now'), NULL, NULL, NULL, 'agent',
		         2, datetime('now'), 'active', 0, 0, NULL, 0, 0, 0, NULL, NULL)`,
	).run("mem-idle-1", "npm test must pass before any commit");
	s.close();
}

function requireHooks(): NonNullable<typeof hooks> {
	if (!hooks) throw new Error("plugin not booted");
	return hooks;
}

function proposalCount(): number {
	const s = secondStore();
	const row = s
		.prepare("SELECT COUNT(*) AS n FROM curation_proposals")
		.get() as { n: number };
	s.close();
	return row.n;
}

function writeCount(): number {
	const s = secondStore();
	const row = s.prepare("SELECT COUNT(*) AS n FROM artifact_writes").get() as {
		n: number;
	};
	s.close();
	return row.n;
}

function lastCurationAt(): string {
	const s = secondStore();
	const row = s
		.prepare("SELECT value FROM kevin_settings WHERE key = 'last_curation_at'")
		.get() as { value: string } | undefined;
	s.close();
	return row?.value ?? "";
}

async function fireIdle(): Promise<void> {
	await requireHooks().event?.({
		event: {
			type: "session.idle",
			properties: { sessionID: "idle-sess" },
		} as never,
	});
}

describe("K6-015 — session-idle curation generation behind curation_enabled", () => {
	beforeEach(async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-idle-"));
		await bootPlugin();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (hooks) await hooks.dispose?.();
		hooks = undefined;
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("with curation_enabled = '0', session.idle creates no proposals and calls no Curator method", async () => {
		seed({ curationEnabled: "0" });
		const spy = vi.spyOn(Curator.prototype, "propose");
		await fireIdle();
		expect(spy).not.toHaveBeenCalled();
		expect(proposalCount()).toBe(0);
		expect(writeCount()).toBe(0);
	});

	it("with curation_enabled = '1', one idle event creates a proposal; a second within the throttle window creates none", async () => {
		seed();
		await fireIdle();
		expect(proposalCount()).toBe(1);
		expect(lastCurationAt()).not.toBe("");
		await fireIdle();
		expect(proposalCount()).toBe(1);
		expect(writeCount()).toBe(0);
	});

	it("a throwing Curator does not prevent archiver.run() and the hook resolves without rejecting", async () => {
		seed();
		const archiverSpy = vi.spyOn(Archiver.prototype, "run");
		const curatorSpy = vi
			.spyOn(Curator.prototype, "propose")
			.mockImplementation(() => {
				throw new Error("curation exploded");
			});
		await expect(fireIdle()).resolves.toBeUndefined();
		expect(curatorSpy).toHaveBeenCalledTimes(1);
		expect(archiverSpy).toHaveBeenCalled();
		expect(proposalCount()).toBe(0);
		expect(writeCount()).toBe(0);
	});

	it("any number of idle events produces no artifact_writes row (dry-run only)", async () => {
		seed();
		for (let i = 0; i < 3; i++) await fireIdle();
		expect(proposalCount()).toBe(1);
		expect(writeCount()).toBe(0);
	});
});
