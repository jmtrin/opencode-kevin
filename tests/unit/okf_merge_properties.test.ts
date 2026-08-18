import { describe, expect, it } from "vitest";
import { computeConfidence } from "../../plugin/confidence.js";
import {
	type OkfEntry,
	computeEntryId,
	deriveConfidence,
	merge,
	parse,
	serialize,
} from "../../plugin/okf.js";

const REPO = "8f3a2c1d9e7b6045";
const VERSION = "0.8.0";

// A seeded PRNG so failures are reproducible; the seed is printed in
// every assertion message. No fast-check — the zero-new-dependency
// rule holds.
function xorshift32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s ^= s << 13;
		s >>>= 0;
		s ^= s >> 17;
		s ^= s << 5;
		s >>>= 0;
		return s / 0xffffffff;
	};
}

const TYPES = ["decision", "rule", "pattern", "solution"] as const;
const OPS = ["assert", "tombstone"] as const;

// Adversarial generator. The entry_id is DERIVED from (type, statement,
// scope) — so payload fields that do not participate in the id
// (evidence, recurrence, origin, author_hash, op, created_at,
// supersedes) can differ freely while the id collides: that is the
// "colliding entry_ids with differing payloads" case. Payloads also
// produce all-null optional fields, mixed ops, identical counters and
// created_at strings differing only in the final digit.
function makeEntry(rnd: () => number, stmtIdx: number): OkfEntry {
	const type = "rule";
	const statement = `statement ${stmtIdx} with src/routes/api.ts:${stmtIdx % 99}`;
	return {
		entry_id: computeEntryId(type, statement, null),
		type,
		statement,
		scope: null,
		evidence: [0, 1, 4, 5][Math.floor(rnd() * 4)],
		recurrence: [0, 1, 3][Math.floor(rnd() * 3)],
		origin: ["pattern", "decision", "rule"][Math.floor(rnd() * 3)],
		author_hash:
			rnd() < 0.25 ? null : (rnd() * 0xffffffff).toString(16).padStart(16, "0"),
		op: OPS[Math.floor(rnd() * OPS.length)],
		created_at: `2026-08-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:00:00Z`,
		supersedes:
			rnd() < 0.2 ? (rnd() * 0xffffffff).toString(16).padStart(16, "0") : null,
	};
}

function makeCorpus(rnd: () => number): OkfEntry[] {
	// A corpus is a SET by entry_id: statement indices are unique within
	// one side. Cross-side collisions remain frequent (small pool), and
	// each side of a collision carries a different payload.
	const pool = [0, 1, 2, 3, 4, 5, 6, 7];
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	const n = Math.floor(rnd() * 9); // 0..8 entries
	return pool.slice(0, n).map((idx) => makeEntry(rnd, idx));
}

function ser(entries: OkfEntry[]): string {
	return serialize(entries, REPO, VERSION);
}

function expectSer(
	actual: OkfEntry[],
	expected: OkfEntry[],
	seed: number,
	label: string,
): void {
	expect(ser(actual), `${label} (seed ${seed})`).toBe(ser(expected));
}

describe("K8-014 — merge(): semilattice property tests (plan §5.4)", () => {
	it("commutativity: merge(a, b) === merge(b, a) for 1000 random pairs", () => {
		const seed = 0x5eed0001;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 1000; i++) {
			const a = makeCorpus(rnd);
			const b = makeCorpus(rnd);
			expectSer(merge(a, b), merge(b, a), seed, `commutativity pair ${i}`);
		}
	});

	it("associativity: merge(merge(a, b), c) === merge(a, merge(b, c)) for 1000 random triples", () => {
		const seed = 0x5eed0002;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 1000; i++) {
			const a = makeCorpus(rnd);
			const b = makeCorpus(rnd);
			const c = makeCorpus(rnd);
			expectSer(
				merge(merge(a, b), c),
				merge(a, merge(b, c)),
				seed,
				`associativity triple ${i}`,
			);
		}
	});

	it("idempotence: merge(a, a) === a for 1000 random corpora", () => {
		const seed = 0x5eed0003;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 1000; i++) {
			const a = makeCorpus(rnd);
			expectSer(merge(a, a), a, seed, `idempotence corpus ${i}`);
		}
	});

	it("identity: merge([], a) === a and merge(a, []) === a for 1000 random corpora", () => {
		const seed = 0x5eed0004;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 1000; i++) {
			const a = makeCorpus(rnd);
			expectSer(merge([], a), a, seed, `left identity ${i}`);
			expectSer(merge(a, []), a, seed, `right identity ${i}`);
		}
	});

	it("the folded count equals the number of entry_ids present in both inputs", () => {
		const seed = 0x5eed0005;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 200; i++) {
			const a = makeCorpus(rnd);
			const b = makeCorpus(rnd);
			const idsA = new Set(a.map((e) => e.entry_id));
			const idsB = new Set(b.map((e) => e.entry_id));
			const both = [...idsA].filter((id) => idsB.has(id)).length;
			const r = parse(ser(a) + ser(b));
			expect(
				r.folded,
				`folded === intersection (seed ${seed}, pair ${i})`,
			).toBe(both);
		}
	});

	it("a fixed seed is checked in as a regression guard alongside the random runs", () => {
		const seed = 0x0badf00d;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 100; i++) {
			const a = makeCorpus(rnd);
			const b = makeCorpus(rnd);
			const c = makeCorpus(rnd);
			expectSer(
				merge(a, b),
				merge(b, a),
				seed,
				`fixed-seed commutativity ${i}`,
			);
			expectSer(
				merge(merge(a, b), c),
				merge(a, merge(b, c)),
				seed,
				`fixed-seed associativity ${i}`,
			);
			expectSer(merge(a, a), a, seed, `fixed-seed idempotence ${i}`);
		}
	});

	it("plan §11.2 check 18: the demotion signal survives the round trip", () => {
		// An entry with evidence 5 / recurrence 3 merged with a copy
		// carrying recurrence 0 must yield recurrence 3 — the max merge —
		// and a derived confidence equal to the two-sided formula, never
		// the undemoted value.
		const statement = "the build keeps failing on the same import";
		const id = computeEntryId("rule", statement, "project");
		const base = {
			entry_id: id,
			type: "rule" as const,
			statement,
			scope: "project" as const,
			origin: "causal",
			author_hash: null,
			op: "assert" as const,
			created_at: "2026-08-18T00:00:00Z",
			supersedes: null,
		};
		const demoted: OkfEntry = { ...base, evidence: 5, recurrence: 3 };
		const fresh: OkfEntry = { ...base, evidence: 5, recurrence: 0 };

		const folded = parse(ser([demoted]) + ser([fresh]));
		const winner = folded.entries[0];
		expect(winner?.recurrence).toBe(3);
		expect(deriveConfidence(winner as OkfEntry)).toBe(computeConfidence(5, 3));
		expect(deriveConfidence(winner as OkfEntry)).not.toBe(
			computeConfidence(5, 0),
		);
	});
});
