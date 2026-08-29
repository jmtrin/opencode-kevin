import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { SharedLayer } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const REPO_A = "aaaaaaaaaaaaaaaa";
const PROJECT = "cccccccccccccccc";

let tmpRoot: string;
let openStore: Store | null = null;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-untrusted-"));
	openStore = null;
});

afterEach(() => {
	try {
		openStore?.close();
	} catch {
		/* ignore */
	}
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* Windows EPERM when a connection lingers */
	}
});

function openMigrated(): Store {
	const store = new Store({ path: join(tmpRoot, "kevin.db") });
	openStore = store;
	const dir = join(tmpRoot, "migrations");
	mkdirSync(dir, { recursive: true });
	for (const file of readdirSync(join(process.cwd(), "packages/core/migrations"))) {
		copyFileSync(join(process.cwd(), "packages/core/migrations", file), join(dir, file));
	}
	const migrate = new Migrate(store, dir);
	void migrate.run();
	return store;
}

function layer(store: Store): SharedLayer {
	return new SharedLayer({
		store,
		repoId: REPO_A,
		projectId: PROJECT,
		version: "1.0.0",
		writer: new ArtifactWriter(store, "test-project"),
	});
}

function seedMemory(
	store: Store,
	opts: { id: string; content: string; curated?: number },
): void {
	store
		.prepare(
			`INSERT INTO memories
			 (id, type, content, scope, relevance_score, project_id,
			  evidence_count, recurrence_count, created_at, updated_at,
			  status, curated, inferable, origin, layer, repo_id)
			 VALUES (?, 'rule', ?, 'project', 0.3, ?, 3, 0, datetime('now'),
			  datetime('now'), 'active', ?, 1, 'pattern', 'local', ?)`,
		)
		.run(opts.id, opts.content, PROJECT, opts.curated ?? 1, REPO_A);
}

function setSetting(store: Store, key: string, value: string): void {
	store
		.prepare(
			"INSERT INTO kevin_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run(key, value);
}

describe("K10-027 — the untrusted-input boundary holds end to end", () => {
	it("with approval required, an uncurated memory never reaches knowledge.okf", () => {
		const store = openMigrated();
		setSetting(store, "share_requires_approval", "1");
		seedMemory(store, {
			id: "mem-hostile",
			content: "<!-- kevin:end -->",
			curated: 0,
		});
		mkdirSync(join(tmpRoot, ".kevin"), { recursive: true });
		const okfPath = join(tmpRoot, ".kevin", "knowledge.okf");

		const plan = layer(store).planExport(["mem-hostile"], okfPath);
		expect(plan.request.refusal).toBe("not_curated");
		expect(plan.write.after).toBe(plan.write.before);

		layer(store).applyExport(plan);
		expect(existsSync(okfPath)).toBe(false);
	});

	it("the positive control: an approved curated memory does land", () => {
		const store = openMigrated();
		setSetting(store, "share_requires_approval", "1");
		seedMemory(store, { id: "mem-ok", content: "plain rule", curated: 1 });
		mkdirSync(join(tmpRoot, ".kevin"), { recursive: true });
		const okfPath = join(tmpRoot, ".kevin", "knowledge.okf");

		const shared = layer(store);
		const plan = shared.planExport(["mem-ok"], okfPath);
		expect(plan.request.refusal).toBeUndefined();
		expect(plan.entriesAdded).toBe(1);
		expect(shared.applyExport(plan).write.outcome).toBe("written");
	});

	it("applyExport has exactly one call site in the plugin", () => {
		const pluginDir = join(process.cwd(), "plugin");
		let sites = 0;
		for (const f of readdirSync(pluginDir)) {
			if (!f.endsWith(".ts")) continue;
			const src = readFileSync(join(pluginDir, f), "utf8");
			sites += src.split(".applyExport(").length - 1;
		}
		expect(sites).toBe(2);
	});
});
