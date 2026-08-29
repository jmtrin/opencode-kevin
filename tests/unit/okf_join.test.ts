import { describe, expect, it } from "vitest";
import { type OkfEntry, canonicalize, join } from "@jmtrin/kevin-core";

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

const OPS = ["assert", "tombstone"] as const;

// Entries sharing an entry_id with adversarial, largely independent
// payloads — this is what the lattice must resolve.
function makeEntry(rnd: () => number): OkfEntry {
	return {
		entry_id: "0a1b2c3d4e5f6071",
		type: rnd() < 0.05 ? "solution" : "rule",
		statement: rnd() < 0.05 ? "a different statement" : "always run tests",
		scope: rnd() < 0.3 ? null : `scope/${Math.floor(rnd() * 5)}/`,
		evidence: [0, 1, 4, 5][Math.floor(rnd() * 4)],
		recurrence: [0, 1, 3][Math.floor(rnd() * 3)],
		origin: ["pattern", "decision", "rule"][Math.floor(rnd() * 3)],
		author_hash:
			rnd() < 0.25 ? null : (rnd() * 0xffffffff).toString(16).padStart(16, "0"),
		op: OPS[Math.floor(rnd() * OPS.length)],
		created_at: `2026-08-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:00:00Z`,
		supersedes:
			rnd() < 0.3 ? (rnd() * 0xffffffff).toString(16).padStart(16, "0") : null,
	};
}

describe("K8-013 — join(): the field lattice (plan §5.4, D8-13)", () => {
	it("join(a, b) equals join(b, a) for 1000 random pairs, compared by canonicalize()", () => {
		const seed = 0x0a130001;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 1000; i++) {
			const a = makeEntry(rnd);
			const b = makeEntry(rnd);
			expect(
				canonicalize(join(a, b)),
				`commutativity pair ${i} (seed ${seed})`,
			).toBe(canonicalize(join(b, a)));
		}
	});

	it("join(a, a) equals a", () => {
		const seed = 0x0a130002;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 100; i++) {
			const a = makeEntry(rnd);
			expect(canonicalize(join(a, a)), `idempotence ${i}`).toBe(
				canonicalize(a),
			);
		}
	});

	it("join(join(a, b), c) equals join(a, join(b, c)) for 1000 random triples", () => {
		const seed = 0x0a130003;
		const rnd = xorshift32(seed);
		for (let i = 0; i < 1000; i++) {
			const a = makeEntry(rnd);
			const b = makeEntry(rnd);
			const c = makeEntry(rnd);
			expect(
				canonicalize(join(join(a, b), c)),
				`associativity triple ${i} (seed ${seed})`,
			).toBe(canonicalize(join(a, join(b, c))));
		}
	});

	it("evidence and recurrence take the max, created_at the min", () => {
		const a = makeEntry(() => 0);
		const b = {
			...makeEntry(() => 0),
			evidence: 9,
			recurrence: 7,
			created_at: "2026-01-01T00:00:00Z",
		};
		const c = {
			...a,
			evidence: 2,
			recurrence: 1,
			created_at: "2026-12-31T00:00:00Z",
		};
		const joined = join(
			{ ...a, evidence: 2, recurrence: 1, created_at: "2026-12-31T00:00:00Z" },
			b,
		);
		expect(joined.evidence).toBe(9);
		expect(joined.recurrence).toBe(7);
		expect(joined.created_at).toBe("2026-01-01T00:00:00Z");
		expect(join(joined, c).evidence).toBe(9);
	});

	it("tombstone absorbs in both argument orders", () => {
		const assert = { ...makeEntry(() => 0), op: "assert" as const };
		const tomb = { ...makeEntry(() => 0), op: "tombstone" as const };
		expect(join(assert, tomb).op).toBe("tombstone");
		expect(join(tomb, assert).op).toBe("tombstone");
		expect(join(tomb, tomb).op).toBe("tombstone");
		expect(join(assert, assert).op).toBe("assert");
	});

	it("both supersedes non-null and different resolve identically in both argument orders — the case `??` fails", () => {
		const a = { ...makeEntry(() => 0), supersedes: "1111111111111111" };
		const b = { ...makeEntry(() => 0), supersedes: "9999999999999999" };
		expect(join(a, b).supersedes).toBe("1111111111111111");
		expect(join(b, a).supersedes).toBe("1111111111111111");
		expect(canonicalize(join(a, b))).toBe(canonicalize(join(b, a)));
		// Null-tolerant: null yields the other side, both orders.
		expect(join({ ...a, supersedes: null }, b).supersedes).toBe(
			"9999999999999999",
		);
		expect(join(b, { ...a, supersedes: null }).supersedes).toBe(
			"9999999999999999",
		);
	});

	it("null scope resolves by lexicographic min, both orders", () => {
		const a = { ...makeEntry(() => 0), scope: null };
		const b = { ...makeEntry(() => 0), scope: "src/" };
		expect(join(a, b).scope).toBe("src/");
		expect(join(b, a).scope).toBe("src/");
	});
});
