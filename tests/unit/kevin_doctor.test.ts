import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "@jmtrin/kevin-core";
import type { HostSurface } from "../../packages/plugin/src/host.js";
import {
	type DoctorReport,
	buildDoctor,
	countZodCopies,
} from "@jmtrin/kevin-core";
import type { SettingsReader } from "../../packages/plugin/src/native.js";

const SQL_001 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "007_v06_pull.sql"),
	"utf8",
);
const SQL_010 = readFileSync(
	join(process.cwd(), "packages/core/migrations", "010_v09_native.sql"),
	"utf8",
);

const seededSql = [
	SQL_001,
	SQL_003,
	SQL_004,
	SQL_005,
	SQL_006,
	SQL_007,
	SQL_010,
];

let tmpRoot: string;
let store: Store;

const host: HostSurface = {
	pluginVersion: "1.18.18",
	flavour: "v1-only",
	project: { id: null, worktree: null, directory: null },
	hasShell: true,
	v2: { skill: false, reference: false },
	notes: [],
};

const settings: SettingsReader = { getSetting: () => "0" };

function fileStore(): Store {
	return new Store({ path: join(tmpRoot, "doctor.db") });
}

function dbHash(): string {
	const buf = readFileSync(join(tmpRoot, "doctor.db"));
	return createHash("sha256").update(buf).digest("hex");
}

function seedDeadHook(): void {
	store
		.prepare(
			`INSERT INTO hook_liveness
			 (hook, experimental, fire_count, error_count, expected_count,
			  first_seen_at, last_seen_at, dead_since, plugin_version)
			 VALUES ('experimental.chat.system.transform', 1, 0, 0, 5,
			         datetime('now'), datetime('now'), datetime('now'), '1.18.18')`,
		)
		.run();
}

function serializedOutput(report: DoctorReport): string {
	return JSON.stringify(report);
}

describe("K9-018 — kevin_doctor pure reads (plan §5.5, D9-09)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-doctor-"));
		store = fileStore();
		for (const sql of seededSql) store.exec(sql);
	});

	afterEach(() => {
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("a dead hook yields verdict degraded and heads the hooks list", () => {
		seedDeadHook();
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.verdict).toBe("degraded");
		expect(report.reason).toContain("dead");
		expect(report.hooks[0]?.hook).toBe("experimental.chat.system.transform");
		expect(report.hooks[0]?.state).toBe("dead");
	});

	it("a fresh DB with no checkpoints yields unknown, never healthy", () => {
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.verdict).toBe("unknown");
		expect(report.reason).toBe("no hook reports yet");
	});

	it("the serialized output contains no filesystem paths and no session ids", () => {
		seedDeadHook();
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		const json = serializedOutput(report);
		// The npm scope `@opencode-ai/plugin` legitimately contains a
		// slash (plan §5.5's own example shows it), so what is banned is
		// PATH-shaped text: backslashes, drive letters, separators with
		// file-ish segments, node_modules, and session-id tokens.
		expect(json).not.toMatch(/\\/);
		expect(json).not.toMatch(/[A-Za-z]:\\/);
		expect(json).not.toMatch(/node_modules/);
		expect(json).not.toMatch(/\.md|\.db|\.sql|\.ts|\.js"/);
		expect(json).not.toMatch(/ses_[A-Za-z0-9]{6,}/);
	});

	it("two consecutive calls produce identical output and zero DB writes", () => {
		seedDeadHook();
		const before = dbHash();
		const first = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		const second = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
		expect(dbHash()).toBe(before);
	});

	it("native block reads the last registration per surface", () => {
		store
			.prepare(
				`INSERT INTO native_registrations (id, surface, registered, verified)
				 VALUES ('r1', 'skill', 1, 1), ('r2', 'reference', 1, 0)`,
			)
			.run();
		const report = buildDoctor(store, host, settings, { zodRoot: tmpRoot });
		expect(report.native.enabled).toBe(false);
		expect(report.native.registered).toEqual({ skill: true, reference: true });
		expect(report.native.verified).toEqual({ skill: true, reference: false });
	});

	it("zod_copies counts installed zod copies and reports null on failure", () => {
		const zodDir = join(tmpRoot, "node_modules", "zod");
		mkdirSync(zodDir, { recursive: true });
		writeFileSync(join(zodDir, "package.json"), "{}");
		expect(countZodCopies(tmpRoot)).toEqual({ copies: 1 });
		expect(countZodCopies(join(tmpRoot, "no-such-dir"))).toEqual({
			copies: null,
			note: "zod resolution walk failed",
		});
	});
});
