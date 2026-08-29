import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeContract, diffContract } from "@jmtrin/kevin-core";
import type { PublicContract } from "@jmtrin/kevin-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const FIXTURE = join(REPO_ROOT, "tests", "fixtures", "contract", "v1.json");

function mustFind<T>(arr: readonly T[], pred: (x: T) => boolean): T {
	const found = arr.find(pred);
	if (found === undefined) throw new Error("expected element not found");
	return found;
}

function loadGolden(): PublicContract {
	const raw = readFileSync(FIXTURE, "utf8");
	// Strip leading // comment header (K10-008 AC §2)
	const lines = raw.split("\n");
	const jsonLines = lines.filter((l) => !l.startsWith("//"));
	return JSON.parse(jsonLines.join("\n")) as PublicContract;
}

describe("Contract frozen — golden file (K10-008)", () => {
	it("fixture exists and carries append-only comment header", () => {
		expect(existsSync(FIXTURE)).toBe(true);
		const raw = readFileSync(FIXTURE, "utf8");
		expect(raw.startsWith("//")).toBe(true);
		expect(raw).toMatch(/append-only/i);
	});

	it("live contract diffs cleanly against the fixture (zero confusingDiffS)", () => {
		const golden = loadGolden();
		const live = describeContract();
		const diffs = diffContract(golden, live);
		const confusing = diffs.filter(
			(d) =>
				d.kind === "removed" || d.kind === "changed" || d.kind === "added_bare",
		);
		expect(
			confusing,
			`Contract golden mismatch — live differs from v1.json:\n${confusing.map((d) => `  ${d.kind} ${d.path} — ${d.remedy}`).join("\n")}`,
		).toEqual([]);
	});

	it("removing a tool is classified as removed, adding without since as added_bare", () => {
		const golden = loadGolden();
		const live = describeContract();
		// Simulate removal: drop one tool
		const mutated = JSON.parse(JSON.stringify(live)) as PublicContract;
		const c03 = mustFind(mutated.clauses, (c) => c.id === "C-03");
		(c03.value as Record<string, unknown>).tools = (
			(c03.value as Record<string, unknown>).tools as string[]
		).slice(0, -1);
		const diffs = diffContract(golden, mutated as PublicContract);
		const hasRemoved = diffs.some(
			(d) => d.kind === "removed" && d.clauseId === "C-03",
		);
		expect(hasRemoved).toBe(true);
	});

	it("adding a clause with since is allowed (added_ok) in 1.x", () => {
		const golden = loadGolden();
		const live = describeContract();
		const extended: PublicContract = {
			contractVersion: live.contractVersion,
			clauses: [
				...live.clauses,
				{
					id: "C-10",
					title: "New additive clause",
					stability: "frozen",
					since: "1.1.0",
					value: { note: "allowed" },
				},
			],
		};
		const diffs = diffContract(golden, extended);
		const added = diffs.find((d) => d.clauseId === "C-10");
		expect(added?.kind).toBe("added_ok");
	});

	it("adding a clause without since is added_bare (requires 2.0.0 or revert)", () => {
		const golden = loadGolden();
		const live = describeContract();
		const extended: PublicContract = {
			contractVersion: live.contractVersion,
			clauses: [
				...live.clauses,
				{
					id: "C-10",
					title: "Bare clause",
					stability: "frozen",
					since: "" as unknown as string,
					value: { note: "bare" },
				} as unknown as import("@jmtrin/kevin-core").ContractClause,
			],
		};
		const diffs = diffContract(golden, extended);
		const added = diffs.find((d) => d.clauseId === "C-10");
		expect(added?.kind).toBe("added_bare");
	});

	it("live digests deterministically (stable across two calls)", async () => {
		const { contractDigest } = await import("@jmtrin/kevin-core");
		const a = contractDigest(describeContract());
		const b = contractDigest(describeContract());
		expect(a).toBe(b);
	});
});
