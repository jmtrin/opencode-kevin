import { describe, expect, it } from "vitest";
import {
	handleBridgeCommand,
	parseBridgeCommand,
} from "../../plugin/ChatBridge.js";
import { Store } from "../../plugin/Store.js";
import { proposalToken } from "../../plugin/TuiActions.js";
import { Metrics } from "../../plugin/metrics.js";

describe("ChatBridge", () => {
	describe("parseBridgeCommand — regex table", () => {
		it("matches approve with token", () => {
			const token = "a".repeat(16);
			expect(parseBridgeCommand(`/kevin-approve p1 ${token}`)).toEqual({
				type: "approve",
				proposalId: "p1",
				token,
			});
		});
		it("matches approve with note", () => {
			const token = "b".repeat(16);
			expect(
				parseBridgeCommand(`/kevin-approve p1 ${token} some note here`),
			).toEqual({
				type: "approve",
				proposalId: "p1",
				token,
				note: "some note here",
			});
		});
		it("matches reject with token and note", () => {
			const token = "c".repeat(16);
			expect(parseBridgeCommand(`/kevin-reject p1 ${token} reason`)).toEqual({
				type: "reject",
				proposalId: "p1",
				token,
				note: "reason",
			});
		});
		it("matches ack without token", () => {
			expect(parseBridgeCommand("/kevin-ack c1")).toEqual({
				type: "ack",
				conflictId: "c1",
			});
		});
		it("near-miss /kevins does not match", () => {
			const token = "a".repeat(16);
			expect(parseBridgeCommand(`/kevins-approve p1 ${token}`)).toBeNull();
			expect(parseBridgeCommand(`/kevin-approves p1 ${token}`)).toBeNull();
			expect(parseBridgeCommand(` /kevin-approve p1 ${token}`)).toBeNull();
		});
		it("rejects non-hex or short token", () => {
			expect(parseBridgeCommand("/kevin-approve p1 abc")).toBeNull();
			expect(
				parseBridgeCommand(`/kevin-approve p1 ${"g".repeat(16)}`),
			).toBeNull(); // g not hex
			expect(
				parseBridgeCommand(`/kevin-approve p1 ${"a".repeat(15)}`),
			).toBeNull();
			expect(
				parseBridgeCommand(`/kevin-approve p1 ${"a".repeat(17)} extra`),
			).toBeNull(); // extra char makes token 17
		});
		it("rejects approve without token", () => {
			expect(parseBridgeCommand("/kevin-approve p1")).toBeNull();
		});
		it("rejects wrong spacing", () => {
			const token = "a".repeat(16);
			// Missing space between command and id should not match (exact regex)
			expect(parseBridgeCommand(`/kevin-approvep1 ${token}`)).toBeNull();
		});
	});

	describe("handleBridgeCommand — valid approve e2e + stale second call", () => {
		it("swallows valid approve, second identical is stale pass-through", () => {
			let pending = [{ id: "p1", proposedText: "hello world" }];
			const token = proposalToken("p1", "hello world");
			let approved: string | null = null;
			const deps = {
				getPending: () => pending,
				approve: (id: string) => {
					approved = id;
					// Simulate state transition: remove from pending after approve
					pending = [];
				},
				reject: () => {},
				acknowledge: () => {},
				metrics: null,
			};
			const r1 = handleBridgeCommand(`/kevin-approve p1 ${token}`, deps);
			expect(r1.handled).toBe(true);
			expect(r1.status).toBe("applied");
			expect(approved).toBe("p1");
			// Second identical — now pending empty → stale → pass-through (not swallowed)
			const r2 = handleBridgeCommand(`/kevin-approve p1 ${token}`, deps);
			expect(r2.handled).toBe(false);
			expect(r2.status).toBe("stale_skipped");
		});
	});

	describe("pass-through purity", () => {
		it("returns byte-identical forward for every non-match", () => {
			const samples = [
				"hello world",
				"/kevin-approve p1 abc", // invalid token
				"/kevin-reject p1 nothex00000000",
				`/kevin-approve p1 ${"a".repeat(15)}`, // short
				" /kevin-approve p1 aaaaaaaaaaaaaaaa",
				"/kevin-ack", // missing id
				"/KEVIN-approve p1 aaaaaaaaaaaaaaaa",
				"kevin-approve p1 aaaaaaaaaaaaaaaa",
				"/kevin-approve p1 aaaaaaaaaaaaaaaa extra note but valid? actually this IS valid — skip",
				"Please run /kevin-approve p1 aaaaaaaaaaaaaaaa later",
			];
			const deps = {
				getPending: () => [],
				approve: () => {},
				reject: () => {},
				acknowledge: () => {},
			};
			for (const s of samples) {
				// If string is actually a valid command, it would be handled; we filter those out
				if (parseBridgeCommand(s)) continue;
				const r = handleBridgeCommand(s, deps);
				expect(r.handled).toBe(false);
				// Pass-through means caller forwards s byte-identically; we just assert not swallowed
				expect(r.status).toBeUndefined();
			}
		});
	});

	describe("hot-path budget", () => {
		it("matcher p95 < 0.5ms on non-match", () => {
			const samples = Array.from(
				{ length: 1000 },
				(_, i) => `hello world ${i} — not a command`,
			);
			const start = performance.now();
			const times: number[] = [];
			for (const s of samples) {
				const t0 = performance.now();
				parseBridgeCommand(s);
				times.push(performance.now() - t0);
			}
			times.sort((a, b) => a - b);
			const p95 = times[Math.floor(times.length * 0.95)];
			expect(p95).toBeLessThan(0.5);
			// Also total time should be reasonable
			expect(performance.now() - start).toBeLessThan(500);
		});
	});

	describe("ack handling", () => {
		it("swallows valid ack without token verification", () => {
			let acked: string | null = null;
			const deps = {
				getPending: () => [],
				approve: () => {},
				reject: () => {},
				acknowledge: (id: string) => {
					acked = id;
				},
			};
			const r = handleBridgeCommand("/kevin-ack c-123", deps);
			expect(r.handled).toBe(true);
			expect(r.status).toBe("applied");
			expect(acked).toBe("c-123");
		});
	});

	describe("metrics", () => {
		it("increments tui_actions_invoked on valid command", () => {
			const store = new Store({ path: ":memory:" });
			const metrics = new Metrics(store, 0);
			const token = proposalToken("p1", "text");
			const deps = {
				getPending: () => [{ id: "p1", proposedText: "text" }],
				approve: () => {},
				reject: () => {},
				acknowledge: () => {},
				metrics,
			};
			const r = handleBridgeCommand(`/kevin-approve p1 ${token}`, deps);
			expect(r.handled).toBe(true);
			metrics.flush();
			const row = store
				.prepare(
					"SELECT value FROM kevin_metrics WHERE key='tui_actions_invoked'",
				)
				.get() as { value: number } | undefined;
			expect(row?.value).toBe(1);
			store.close();
		});
		it("does not increment on stale/invalid", () => {
			const store = new Store({ path: ":memory:" });
			const metrics = new Metrics(store, 0);
			const deps = {
				getPending: () => [], // empty → stale
				approve: () => {},
				reject: () => {},
				acknowledge: () => {},
				metrics,
			};
			const token = "a".repeat(16);
			const r = handleBridgeCommand(`/kevin-approve p1 ${token}`, deps);
			expect(r.handled).toBe(false);
			metrics.flush();
			let row: { value: number } | undefined;
			try {
				row = store
					.prepare(
						"SELECT value FROM kevin_metrics WHERE key='tui_actions_invoked'",
					)
					.get() as { value: number } | undefined;
			} catch {
				row = undefined;
			}
			expect(row).toBeUndefined();
			store.close();
		});
	});
});
