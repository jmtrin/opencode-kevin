import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ArtifactWriter,
	MARKER_BEGIN,
	MARKER_END,
} from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { Metrics } from "@jmtrin/kevin-core";

let tmpRoot: string;
let store: Store;
let metrics: Metrics;

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

function makeMigratedStore(): Store {
	const s = new Store({ path: ":memory:" });
	for (const sql of [SQL_001, SQL_003, SQL_004, SQL_005, SQL_006, SQL_007]) {
		s.exec(sql);
	}
	return s;
}

function auditRows(): Array<Record<string, unknown>> {
	return store
		.prepare("SELECT * FROM artifact_writes ORDER BY rowid")
		.all() as Array<Record<string, unknown>>;
}

function writer(): ArtifactWriter {
	return new ArtifactWriter(store, "test-project", metrics);
}

function whole(path: string, content: string) {
	return { path, mode: "whole" as const, content };
}

describe('K8-019 — ArtifactWriter mode:"whole"', () => {
	beforeEach(() => {
		store = makeMigratedStore();
		metrics = new Metrics(store);
	});

	afterEach(() => {
		metrics.close();
		store.close();
		if (tmpRoot !== undefined) {
			rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	function target(name = "knowledge.okf"): string {
		return join(tmpRoot, name);
	}

	it("replaces the entire file — markers and human content included", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-whole-replace-"));
		const p = target();
		writeFileSync(
			p,
			`# Title\nIntro\n${MARKER_BEGIN}\nold\n${MARKER_END}\nFooter\n`,
			"utf8",
		);
		const plan = writer().plan(whole(target(), "line one\nline two\n"));
		expect(plan.outcome).toBe("written");
		expect(writer().apply(plan)).toBe("written");
		expect(readFileSync(p, "utf8")).toBe("line one\nline two\n");
	});

	it("creates the file when it does not exist", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-whole-create-"));
		const plan = writer().plan(whole(target(), "v1\n"));
		expect(plan.outcome).toBe("written");
		expect(writer().apply(plan)).toBe("written");
		expect(readFileSync(target(), "utf8")).toBe("v1\n");
	});

	it("identical bytes are a noop and the file mtime is untouched", async () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-whole-noop-"));
		const p = target();
		writeFileSync(p, "v1\n", "utf8");
		await new Promise((r) => setTimeout(r, 30));
		const mtimeBefore = statSync(p).mtimeMs;
		const plan = writer().plan(whole(target(), "v1\n"));
		expect(plan.outcome).toBe("noop");
		expect(writer().apply(plan)).toBe("noop");
		expect(statSync(p).mtimeMs).toBe(mtimeBefore);
		expect(readFileSync(p, "utf8")).toBe("v1\n");
	});

	it("a caller-side refusal leaves the file untouched and audits both hashes", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-whole-refuse-"));
		const p = target();
		writeFileSync(p, "on disk\n", "utf8");
		const plan = writer().plan({
			path: p,
			mode: "whole",
			content: "would be new\n",
			refusal: "below_floor",
		});
		expect(plan.outcome).toBe("refused");
		expect(plan.reason).toBe("below_floor");
		expect(plan.after).toBe(plan.before);
		expect(plan.diff).toBe("");
		expect(writer().apply(plan)).toBe("refused");
		expect(readFileSync(p, "utf8")).toBe("on disk\n");
		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].outcome).toBe("refused");
		expect(rows[0].reason).toBe("below_floor");
		expect(rows[0].hash_before).not.toBeNull();
		expect(rows[0].hash_after).not.toBeNull();
		expect(rows[0].hash_before).toBe(rows[0].hash_after);
		expect(String(rows[0].hash_before)).not.toBe("");
	});

	it("a throwing rename leaves the target unchanged and removes the temp file", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-whole-fail-"));
		const p = target();
		writeFileSync(p, "old\n", "utf8");
		const plan = writer().plan(whole(target(), "new\n"));
		const spy = vi
			.spyOn(
				ArtifactWriter.prototype as unknown as {
					renameTemp: (t: string, x: string) => void;
				},
				"renameTemp",
			)
			.mockImplementation(() => {
				throw new Error("simulated rename failure");
			});
		try {
			expect(() => writer().apply(plan)).toThrow("simulated rename failure");
		} finally {
			spy.mockRestore();
		}
		expect(readFileSync(p, "utf8")).toBe("old\n");
		expect(
			readdirSync(tmpRoot).filter((f) => f.endsWith(".kevin.tmp")),
		).toEqual([]);
	});

	it("hash_before of row N equals hash_after of row N−1; metrics match the row counts", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-whole-chain-"));
		const p = target();
		writeFileSync(p, "v1\n", "utf8");
		const w = writer();
		expect(w.apply(w.plan(whole(target(), "v2\n")))).toBe("written");
		expect(w.apply(w.plan(whole(target(), "v2\n")))).toBe("noop");
		expect(w.apply(w.plan(whole(target(), "v3\n")))).toBe("written");
		const rows = auditRows();
		expect(rows).toHaveLength(3);
		expect(rows[1].hash_before).toBe(rows[0].hash_after);
		expect(rows[2].hash_before).toBe(rows[1].hash_after);
		expect(rows[0].hash_before).not.toBe(rows[2].hash_after);
		expect(metrics.get("artifact_writes_total")).toBe(
			rows.filter((r) => r.outcome === "written").length,
		);
		expect(metrics.get("artifact_writes_noop")).toBe(
			rows.filter((r) => r.outcome === "noop").length,
		);
	});

	it("plan() with an explicit markers request is byte-for-byte the two-argument form", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-whole-overload-"));
		const p = target("AGENTS.md");
		writeFileSync(p, `# T\n${MARKER_BEGIN}\nold\n${MARKER_END}\n`, "utf8");
		const viaArgs = writer().plan(p, "new");
		const viaRequest = writer().plan({
			path: p,
			mode: "markers",
			content: "new",
		});
		expect(viaRequest).toEqual(viaArgs);
	});
});
