import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMailbox } from "@jmtrin/kevin-core";

describe("K12-005 — readMailbox tolerant parser", () => {
	it("ok file returns actions", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-mb-"));
		mkdirSync(join(root, "tui"), { recursive: true });
		writeFileSync(
			join(root, "tui", "actions.json"),
			JSON.stringify({
				issuedAt: new Date().toISOString(),
				actions: [
					{ type: "approve", proposalId: "p1", token: "abcd1234abcd1234" },
				],
			}),
			"utf8",
		);
		const res = readMailbox(root);
		expect(res.actions.length).toBe(1);
		expect(res.actions[0]).toEqual({
			type: "approve",
			proposalId: "p1",
			token: "abcd1234abcd1234",
		});
		expect(res.warnings.length).toBe(0);
		rmSync(root, { recursive: true, force: true });
	});

	it("unknown type dropped with warning", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-mb-"));
		mkdirSync(join(root, "tui"), { recursive: true });
		writeFileSync(
			join(root, "tui", "actions.json"),
			JSON.stringify({
				issuedAt: new Date().toISOString(),
				actions: [
					{ type: "approve", proposalId: "p1", token: "a".repeat(16) },
					{ type: "unknown_thing", proposalId: "p2" },
					{ type: "acknowledge", conflictId: "c1" },
				],
			}),
			"utf8",
		);
		const res = readMailbox(root);
		expect(res.actions.length).toBe(2);
		expect(res.warnings.some((w) => w.includes("unknown_type"))).toBe(true);
		rmSync(root, { recursive: true, force: true });
	});

	it("broken JSON returns empty + warning", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-mb-"));
		mkdirSync(join(root, "tui"), { recursive: true });
		writeFileSync(join(root, "tui", "actions.json"), "{{{", "utf8");
		const res = readMailbox(root);
		expect(res.actions.length).toBe(0);
		expect(res.warnings).toContain("malformed_json");
		rmSync(root, { recursive: true, force: true });
	});

	it("missing file returns empty no error", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-mb-"));
		const res = readMailbox(root);
		expect(res.actions.length).toBe(0);
		expect(res.warnings.length).toBe(0);
		rmSync(root, { recursive: true, force: true });
	});

	it("non-array actions field treated as broken", () => {
		const root = mkdtempSync(join(tmpdir(), "tui-mb-"));
		mkdirSync(join(root, "tui"), { recursive: true });
		writeFileSync(
			join(root, "tui", "actions.json"),
			JSON.stringify({ issuedAt: "x", actions: "not-array" }),
			"utf8",
		);
		const res = readMailbox(root);
		expect(res.actions.length).toBe(0);
		expect(res.warnings).toContain("invalid_shape");
		rmSync(root, { recursive: true, force: true });
	});
});
