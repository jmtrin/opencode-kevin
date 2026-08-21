import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../plugin/Store.js";
import type { HostSurface } from "../../plugin/host.js";
import { handleNative } from "../../plugin/kevin_native.js";

const SQL_001 = readFileSync(
	join(process.cwd(), "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(process.cwd(), "migrations", "003_v02_signal.sql"),
	"utf8",
);
const SQL_004 = readFileSync(
	join(process.cwd(), "migrations", "004_v03_knowledge.sql"),
	"utf8",
);
const SQL_005 = readFileSync(
	join(process.cwd(), "migrations", "005_v04_signal.sql"),
	"utf8",
);
const SQL_006 = readFileSync(
	join(process.cwd(), "migrations", "006_v05_glassbox.sql"),
	"utf8",
);
const SQL_007 = readFileSync(
	join(process.cwd(), "migrations", "007_v06_pull.sql"),
	"utf8",
);
const SQL_010 = readFileSync(
	join(process.cwd(), "migrations", "010_v09_native.sql"),
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

function v1Host(): HostSurface {
	return {
		pluginVersion: "1.17.6",
		flavour: "v1-only",
		project: { id: null, worktree: null, directory: null },
		hasShell: true,
		v2: { skill: false, reference: false },
		notes: [],
	};
}

function v2Host(): HostSurface {
	return {
		pluginVersion: "1.18.18",
		flavour: "v1+v2",
		project: { id: null, worktree: null, directory: null },
		hasShell: true,
		v2: { skill: true, reference: true },
		notes: [],
	};
}

function settings(value: string) {
	return {
		getSetting: (key: string, fallback = "0") =>
			key === "native_registration_enabled" ? value : fallback,
	};
}

function storedSetting(): string | null {
	const row = store
		.prepare(
			"SELECT value FROM kevin_settings WHERE key = 'native_registration_enabled'",
		)
		.get() as { value: string } | undefined;
	return row?.value ?? null;
}

describe("K9-019 — kevin_native show/enable/disable (plan §5.5, D9-12)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-native-tool-"));
		store = new Store({ path: join(tmpRoot, "test.db") });
		for (const sql of seededSql) store.exec(sql);
	});

	afterEach(() => {
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("show on a v1-only host reports enabled false, effective false, with a reason", () => {
		const report = handleNative("show", {
			host: v1Host(),
			store,
			settings: settings("0"),
		});
		expect(report.action).toBe("show");
		expect(report.value).toBe("0");
		expect(report.effective).toBe(false);
		expect(report.reason).toContain("v2 subpath absent");
		expect(report.registrations).toEqual([]);
	});

	it("enable on a v1-only host sets '1', reports effective false, and does not throw", () => {
		const report = handleNative("enable", {
			host: v1Host(),
			store,
			settings: settings("0"),
		});
		expect(report.action).toBe("enable");
		expect(report.value).toBe("1");
		expect(report.effective).toBe(false);
		expect(report.reason).toContain("inert");
		expect(report.note).toContain("restart");
		expect(storedSetting()).toBe("1");
	});

	it("stored value is exactly the raw TEXT '1' or '0'", () => {
		handleNative("enable", { host: v2Host(), store, settings: settings("0") });
		const row = store
			.prepare(
				"SELECT typeof(value) AS t, value FROM kevin_settings WHERE key = 'native_registration_enabled'",
			)
			.get() as { t: string; value: string };
		expect(row.t).toBe("text");
		expect(row.value).toBe("1");
		handleNative("disable", { host: v2Host(), store, settings: settings("1") });
		const row2 = store
			.prepare(
				"SELECT typeof(value) AS t, value FROM kevin_settings WHERE key = 'native_registration_enabled'",
			)
			.get() as { t: string; value: string };
		expect(row2.t).toBe("text");
		expect(row2.value).toBe("0");
	});

	it("enable on a v2 host reports effective true", () => {
		const report = handleNative("enable", {
			host: v2Host(),
			store,
			settings: settings("0"),
		});
		expect(report.effective).toBe(true);
		expect(report.reason).toBeUndefined();
	});

	it("no action re-runs probeHost()", async () => {
		const mod = await import("../../plugin/host.js");
		const spy = vi.spyOn(mod, "probeHost");
		handleNative("show", { host: v1Host(), store, settings: settings("0") });
		handleNative("enable", { host: v1Host(), store, settings: settings("0") });
		handleNative("disable", { host: v1Host(), store, settings: settings("1") });
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
