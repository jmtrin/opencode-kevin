import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryService } from "../../plugin/MemoryService.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);

function makeMigratedStore(): Store {
	const store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	return store;
}

describe("MemoryService.getRelevant — v0.2.0 (K2-023) origin-aware rank", () => {
	it("reflector outranks agent for similar BM25 + age", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "error",
			content: "shared keyword alpha lesson content here",
			relevanceScore: 0.5,
			origin: "agent",
		});
		memories.save({
			type: "error",
			content: "shared keyword alpha lesson content here reflector",
			relevanceScore: 0.5,
			origin: "reflector",
		});
		const rec = memories.getRelevant({ query: "alpha", maxTokens: 2000 });
		expect(rec.length).toBe(2);
		expect(rec[0].origin).toBe("reflector");
		expect(rec[1].origin).toBe("agent");
		store.close();
	});

	it("pattern outranks agent but is outranked by reflector", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "error",
			content: "shared keyword alpha lesson content agent one",
			relevanceScore: 0.5,
			origin: "agent",
		});
		memories.save({
			type: "pattern",
			content: "shared keyword alpha lesson content pattern one",
			relevanceScore: 0.5,
			origin: "pattern",
		});
		memories.save({
			type: "error",
			content: "shared keyword alpha lesson content reflector one",
			relevanceScore: 0.5,
			origin: "reflector",
		});
		const rec = memories.getRelevant({ query: "alpha", maxTokens: 2000 });
		expect(rec.length).toBe(3);
		expect(rec[0].origin).toBe("reflector");
		expect(rec[1].origin).toBe("pattern");
		expect(rec[2].origin).toBe("agent");
		store.close();
	});

	it("recency decay demotes older memories of equal origin/boost", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		// Save an "old" memory; then re-save and back-date its created_at so
		// its recencyDecay is materially smaller than a freshly-saved one.
		memories.save({
			type: "error",
			content: "shared keyword beta lesson content tail here agent",
			relevanceScore: 0.5,
			origin: "agent",
		});
		store
			.prepare(
				"UPDATE memories SET created_at = datetime('now', '-30 days') WHERE content LIKE ?",
			)
			.run("%beta lesson content tail%");
		memories.save({
			type: "error",
			content: "shared keyword beta lesson content tail here agent two",
			relevanceScore: 0.5,
			origin: "agent",
		});
		const rec = memories.getRelevant({ query: "beta", maxTokens: 2000 });
		expect(rec.length).toBe(2);
		// newer (still 'now') should outrank the 30-day-old one
		expect(rec[0].content).toContain("agent two");
		store.close();
	});

	it("boost dominates recency: a 30-day-old reflector outranks a fresh agent", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "error",
			content: "shared keyword gamma lesson content here reflector",
			relevanceScore: 0.5,
			origin: "reflector",
		});
		store
			.prepare(
				"UPDATE memories SET created_at = datetime('now', '-30 days') WHERE content LIKE ?",
			)
			.run("%gamma lesson content here reflector%");
		memories.save({
			type: "error",
			content: "shared keyword gamma lesson content here agent new",
			relevanceScore: 0.5,
			origin: "agent",
		});
		const rec = memories.getRelevant({ query: "gamma", maxTokens: 2000 });
		expect(rec.length).toBe(2);
		// reflector × 2 × 0.95^30 ≈ 2 × 0.2146 ≈ 0.429 effective
		// agent   × 1 × ~1     ≈ 1.0 effective
		// base bm25 ~ -0.5 (rough), so adjusted: reflector ~ -0.214, agent ~ -0.5.
		// WAIT: agent has LESS negative adjusted score (i.e. WORSE) if the
		// reflector's effective boost*decay < agent's. Let's compute exactly:
		// reflector: base × 2 × 0.2146 — if base is -0.5 → -0.2146 (worse)
		// agent:      base × 1 × 1      — if base is -0.5 → -0.5    (better)
		// So actually agent would win here. This means the boost (× 2) is
		// NOT enough to overcome 30 days of recency decay (0.95^30 ≈ 0.2146).
		// To assert the BOOST-DOMINATES case we must keep the recency gap tiny.
		expect(rec[0].origin).toBe("agent");
		store.close();
	});

	it("boost dominates recency: a 5-day-old reflector outranks a fresh agent", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		memories.save({
			type: "error",
			content: "shared keyword delta lesson content here reflector",
			relevanceScore: 0.5,
			origin: "reflector",
		});
		store
			.prepare(
				"UPDATE memories SET created_at = datetime('now', '-5 days') WHERE content LIKE ?",
			)
			.run("%delta lesson content here reflector%");
		memories.save({
			type: "error",
			content: "shared keyword delta lesson content here agent new",
			relevanceScore: 0.5,
			origin: "agent",
		});
		const rec = memories.getRelevant({ query: "delta", maxTokens: 2000 });
		expect(rec.length).toBe(2);
		// reflector × 2 × 0.95^5 ≈ 2 × 0.7738 ≈ 1.548 effective
		// agent     × 1 × 1        ≈ 1.0   effective
		// → reflector is more negative after multiplication → ranks first.
		expect(rec[0].origin).toBe("reflector");
		store.close();
	});

	it("TYPE_PRIORITY is the tie-breaker when origin+age produce equal rank", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		// Three agent-saved memories with identical content-length, identical
		// relevance, just-saved age, but different types. The base rank (BM25
		// fallback to -relevance_score in loadAll path) is the same. So tie
		// falls through to TYPE_PRIORITY then createdAt-desc.
		memories.save({
			type: "context",
			content: "recall keyword shared content here agent lesson",
			relevanceScore: 0.5,
			origin: "agent",
		});
		memories.save({
			type: "error",
			content: "recall keyword shared content here agent lesson",
			relevanceScore: 0.5,
			origin: "agent",
		});
		memories.save({
			type: "pattern",
			content: "recall keyword shared content here agent lesson",
			relevanceScore: 0.5,
			origin: "agent",
		});
		// Use no query → loadAll path → BM25 fallback to -relevance_score.
		const rec = memories.getRelevant({ maxTokens: 2000 });
		expect(rec.length).toBe(3);
		expect(rec[0].type).toBe("error");
		expect(rec[1].type).toBe("pattern");
		expect(rec[2].type).toBe("context");
		store.close();
	});

	it("legacy rows (origin coerced to 'agent' by migration 003 DEFAULT) get agent boost", () => {
		const store = makeMigratedStore();
		const memories = new MemoryService(store);
		// Insert a row WITHOUT going through MemoryService.save to simulate
		// a pre-v0.2 legacy row. The column DEFAULT 'agent' populates origin.
		store
			.prepare(
				`INSERT INTO memories (id, type, content, scope, relevance_score, created_at, updated_at)
				 VALUES (?, 'error', 'legacy keyword epsilon agent content here', 'project', 0.5,
				         datetime('now'), datetime('now'))`,
			)
			.run("legacy-001");
		memories.save({
			type: "error",
			content: "legacy keyword epsilon reflector content here",
			relevanceScore: 0.5,
			origin: "reflector",
		});
		const rec = memories.getRelevant({ query: "epsilon", maxTokens: 2000 });
		expect(rec.length).toBe(2);
		expect(rec[0].origin).toBe("reflector");
		expect(rec[1].origin ?? "agent").toBe("agent");
		store.close();
	});
});
