import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
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

function withBlock(body: string): string {
	return `# Title\nIntro\n${MARKER_BEGIN}\n${body}\n${MARKER_END}\nFooter\n`;
}

describe("K6-007 — ArtifactWriter.apply()", () => {
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

	function target(name = "AGENTS.md"): string {
		return join(tmpRoot, name);
	}

	it("rule 7 — a successful apply leaves the target byte-identical to plan.after and no .kevin.tmp", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-apply-ok-"));
		const p = target();
		writeFileSync(p, withBlock("old block"), "utf8");
		const plan = writer().plan(p, "new block line 1\nnew block line 2");
		expect(plan.outcome).toBe("written");
		expect(writer().apply(plan)).toBe("written");
		expect(readFileSync(p, "utf8")).toBe(plan.after);
		expect(
			readdirSync(tmpRoot).filter((f) => f.endsWith(".kevin.tmp")),
		).toEqual([]);
	});

	it("rule 8 — a refused plan leaves the target byte-identical and still audits a refused row", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-apply-ref-"));
		const p = target();
		writeFileSync(p, `# Title\n${MARKER_BEGIN}\nold\n`, "utf8");
		const plan = writer().plan(p, "body");
		expect(plan.outcome).toBe("refused");
		expect(writer().apply(plan)).toBe("refused");
		expect(readFileSync(p, "utf8")).toBe(plan.before);
		const rows = auditRows();
		expect(rows).toHaveLength(1);
		expect(rows[0].outcome).toBe("refused");
		expect(rows[0].reason).not.toBeNull();
		expect(String(rows[0].reason)).not.toBe("");
		expect(rows[0].path).toBe(p);
		expect(rows[0].project_id).toBe("test-project");
	});

	it("three apply calls (written, noop, refused) produce exactly three audit rows", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-apply-3-"));
		const p = target();
		writeFileSync(p, withBlock("block A"), "utf8");

		const w = writer();
		const plan1 = w.plan(p, "block B");
		expect(plan1.outcome).toBe("written");
		expect(w.apply(plan1)).toBe("written");

		const plan2 = w.plan(p, "block B");
		expect(plan2.outcome).toBe("noop");
		expect(w.apply(plan2)).toBe("noop");

		const broken = target("broken.md");
		writeFileSync(broken, `# T\n${MARKER_END}\n`, "utf8");
		const plan3 = w.plan(broken, "body");
		expect(plan3.outcome).toBe("refused");
		expect(w.apply(plan3)).toBe("refused");

		expect(auditRows()).toHaveLength(3);
	});

	it("hash_before of row N equals hash_after of row N−1 for consecutive writes to the same path", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-apply-chain-"));
		const p = target();
		writeFileSync(p, withBlock("v1"), "utf8");
		const w = writer();
		expect(w.apply(w.plan(p, "v2"))).toBe("written");
		expect(w.apply(w.plan(p, "v2"))).toBe("noop");
		expect(w.apply(w.plan(p, "v3"))).toBe("written");
		const rows = auditRows();
		expect(rows).toHaveLength(3);
		expect(rows[1].hash_before).toBe(rows[0].hash_after);
		expect(rows[2].hash_before).toBe(rows[1].hash_after);
		expect(rows[0].hash_before).not.toBe(rows[2].hash_after);
	});

	it("a throwing rename leaves the target unchanged and removes the temp file", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-apply-fail-"));
		const p = target();
		writeFileSync(p, withBlock("old"), "utf8");
		const plan = writer().plan(p, "new");
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
		expect(readFileSync(p, "utf8")).toBe(withBlock("old"));
		expect(
			readdirSync(tmpRoot).filter((f) => f.endsWith(".kevin.tmp")),
		).toEqual([]);
	});

	it("artifact_writes_total and artifact_writes_noop match the row counts by outcome", () => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-apply-metrics-"));
		const p = target();
		writeFileSync(p, withBlock("a"), "utf8");
		const w = writer();
		expect(w.apply(w.plan(p, "b"))).toBe("written");
		expect(w.apply(w.plan(p, "b"))).toBe("noop");
		expect(w.apply(w.plan(p, "c"))).toBe("written");
		const rows = auditRows();
		expect(metrics.get("artifact_writes_total")).toBe(
			rows.filter((r) => r.outcome === "written").length,
		);
		expect(metrics.get("artifact_writes_noop")).toBe(
			rows.filter((r) => r.outcome === "noop").length,
		);
	});
});
