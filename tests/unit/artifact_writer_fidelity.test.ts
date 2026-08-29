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

describe("K6-008 — idempotence, CRLF/BOM preservation, noop", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-fidelity-"));
		store = makeMigratedStore();
		metrics = new Metrics(store);
	});

	afterEach(() => {
		metrics.close();
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	function writer(): ArtifactWriter {
		return new ArtifactWriter(store, "test-project", metrics);
	}

	function target(name = "AGENTS.md"): string {
		return join(tmpRoot, name);
	}

	it("applying the same plan twice yields written then noop, file byte-identical after the second call", () => {
		const p = target();
		writeFileSync(p, `# T\n${MARKER_BEGIN}\nold\n${MARKER_END}\n`, "utf8");
		const w = writer();
		const first = w.plan(p, "new body");
		expect(first.outcome).toBe("written");
		expect(w.apply(first)).toBe("written");
		const second = w.plan(p, "new body");
		expect(second.outcome).toBe("noop");
		expect(w.apply(second)).toBe("noop");
		expect(readFileSync(p, "utf8")).toBe(second.after);
		expect(second.after).toBe(first.after);
	});

	it("a CRLF fixture stays CRLF everywhere, including inside the generated block", () => {
		const p = target();
		writeFileSync(
			p,
			`# Title\r\nIntro\r\n${MARKER_BEGIN}\r\nold\r\n${MARKER_END}\r\nFooter\r\n`,
			"utf8",
		);
		const w = writer();
		const plan = w.plan(p, "b1\nb2\nb3");
		expect(plan.outcome).toBe("written");
		expect(w.apply(plan)).toBe("written");
		const after = readFileSync(p, "utf8");
		const crlf = (after.match(/\r\n/g) ?? []).length;
		const lf = (after.match(/\n/g) ?? []).length;
		expect(lf).toBe(crlf);
		expect(crlf).toBeGreaterThan(3);
		expect(after).toContain(
			`${MARKER_BEGIN}\r\nb1\r\nb2\r\nb3\r\n${MARKER_END}`,
		);
	});

	it("a BOM-prefixed fixture still starts with \\uFEFF; a BOM-free one still does not", () => {
		const pBom = target("bom.md");
		writeFileSync(
			pBom,
			`\uFEFF# T\n${MARKER_BEGIN}\nold\n${MARKER_END}\n`,
			"utf8",
		);
		const w = writer();
		const planBom = w.plan(pBom, "body");
		expect(w.apply(planBom)).toBe("written");
		expect(readFileSync(pBom).toString("utf8").startsWith("\uFEFF")).toBe(true);

		const pPlain = target("plain.md");
		writeFileSync(pPlain, `# T\n${MARKER_BEGIN}\nold\n${MARKER_END}\n`, "utf8");
		const planPlain = w.plan(pPlain, "body");
		expect(w.apply(planPlain)).toBe("written");
		expect(readFileSync(pPlain).toString("utf8").startsWith("\uFEFF")).toBe(
			false,
		);
	});

	it("the noop path creates no .kevin.tmp and never calls rename", () => {
		const p = target();
		writeFileSync(p, `# T\n${MARKER_BEGIN}\nbody\n${MARKER_END}\n`, "utf8");
		const w = writer();
		const plan = w.plan(p, "body");
		expect(plan.outcome).toBe("noop");
		const spy = vi
			.spyOn(
				ArtifactWriter.prototype as unknown as {
					renameTemp: (t: string, x: string) => void;
				},
				"renameTemp",
			)
			.mockImplementation(() => {
				throw new Error("rename must not be called on noop");
			});
		try {
			expect(w.apply(plan)).toBe("noop");
		} finally {
			spy.mockRestore();
		}
		expect(spy).not.toHaveBeenCalled();
		expect(
			readdirSync(tmpRoot).filter((f) => f.endsWith(".kevin.tmp")),
		).toEqual([]);
	});

	it("a mixed-ending fixture produces the same output on 10 consecutive runs", () => {
		const p = target();
		writeFileSync(
			p,
			`a\r\nb\nc\r\n${MARKER_BEGIN}\r\nold\r\n${MARKER_END}\r\nd\n`,
			"utf8",
		);
		const w = writer();
		const first = w.plan(p, "body").after;
		for (let i = 0; i < 10; i++) {
			expect(w.plan(p, "body").after).toBe(first);
		}
	});

	it("a CRLF file whose last line lacks a terminator still detects CRLF", () => {
		const p = target();
		writeFileSync(p, `# T\r\n${MARKER_BEGIN}\r\nold\r\n${MARKER_END}`, "utf8");
		const plan = writer().plan(p, "body");
		expect(plan.outcome).toBe("written");
		expect(plan.after).toContain(`${MARKER_BEGIN}\r\nbody\r\n${MARKER_END}`);
	});
});
