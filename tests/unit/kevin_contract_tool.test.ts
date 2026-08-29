import { describe, expect, it } from "vitest";
import { contractDigest, describeContract } from "@jmtrin/kevin-core";
import { buildKevinContract } from "@jmtrin/kevin-core";

describe("K10-018 — kevin_contract tool", () => {
	it("summary returns version, 16-hex digest, package_version and one line per clause", () => {
		const r = buildKevinContract({ packageVersion: "1.0.0" }, {}) as {
			contract_version: number;
			digest: string;
			package_version: string;
			clauses: {
				id: string;
				title: string;
				stability: string;
				since: string;
			}[];
			deprecated: string[];
		};
		expect(r.contract_version).toBe(1);
		expect(r.digest).toMatch(/^[0-9a-f]{16}$/);
		expect(r.package_version).toBe("1.0.0");
		expect(r.clauses.map((c) => c.id)).toEqual([
			"C-01",
			"C-02",
			"C-03",
			"C-04",
			"C-05",
			"C-06",
			"C-07",
			"C-08",
			"C-09",
		]);
		expect(r.deprecated).toEqual([]);
	});

	it("digest matches contractDigest over the live contract", () => {
		const r = buildKevinContract({ packageVersion: "1.0.0" }, {}) as {
			digest: string;
		};
		expect(r.digest).toBe(contractDigest(describeContract()));
	});

	it("full+clause returns the complete clause value (C-01 marker pair)", () => {
		const r = buildKevinContract(
			{ packageVersion: "1.0.0" },
			{ clause: "C-01", format: "full" },
		) as {
			clause: { id: string; value: unknown };
		};
		expect(r.clause.id).toBe("C-01");
		expect(JSON.stringify(r.clause.value)).toContain("kevin:begin");
	});

	it("unknown clause id is a structured error naming the known ids", () => {
		const r = buildKevinContract(
			{ packageVersion: "1.0.0" },
			{ clause: "C-99" },
		) as { error: string; clause: string; known_clauses: string[] };
		expect(r.error).toBe("unknown_clause");
		expect(r.clause).toBe("C-99");
		expect(r.known_clauses).toContain("C-09");
	});

	it("output carries no machine-specific paths or project ids", () => {
		for (const args of [
			{},
			{ format: "full" as const },
			{ clause: "C-03", format: "full" as const },
			{ clause: "C-08", format: "full" as const },
		]) {
			const out = JSON.stringify(
				buildKevinContract({ packageVersion: "1.0.0" }, args),
			);
			expect(out).not.toMatch(/[A-Za-z]:[\\\\/]/);
			expect(out).not.toMatch(/\/(home|Users)\//);
			expect(out).not.toContain("project_id");
		}
	});
});
