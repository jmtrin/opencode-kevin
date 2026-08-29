import { describe, expect, it } from "vitest";
import { fromMif, toMif } from "@jmtrin/kevin-core";
import type { Memory } from "@jmtrin/kevin-core";

describe("mif codec K15-008", () => {
	it("roundtrip preserves unknown vendorNote field", () => {
		const rows = [{ id: "11111111-1111-1111-1111-111111111111", type: "rule", content: "test content", scope: "project", createdAt: "2026-01-01 00:00:00", fingerprint: "abc", evidenceCount: 1, confidence: 0.7 } as unknown as Memory];
		const env = toMif(rows, { redactPii: false });
		// inject unknown field
		(env.memories[0] as Record<string, unknown>).vendorNote = "hello vendor";
		const { candidates, unknownFieldsPreserved } = fromMif(env);
		expect(unknownFieldsPreserved).toContain("vendorNote");
		expect(candidates[0].unknownFields.vendorNote).toBe("hello vendor");
		// second roundtrip: candidate back to Mif should preserve
		// simulate storing and re-export: we keep unknown via mif_vendor simulation
		const rows2 = [{ ...rows[0], mif_vendor: { vendorNote: "hello vendor" } } as unknown as Memory];
		const env2 = toMif(rows2, { redactPii: false });
		expect((env2.memories[0] as Record<string, unknown>).vendorNote).toBe("hello vendor");
	});
	it("redactPii true masks secret-pattern", () => {
		const rows = [{ id: "22222222-2222-2222-2222-222222222222", type: "rule", content: "API_KEY=supersecret value", scope: "project", createdAt: "2026-01-01 00:00:00", fingerprint: "def" } as unknown as Memory];
		const env = toMif(rows, { redactPii: true });
		expect(env.memories[0].content).not.toContain("supersecret");
		expect(env.memories[0].content).toContain("<redacted>");
		const env2 = toMif(rows, { redactPii: false });
		expect(env2.memories[0].content).toContain("supersecret");
	});
	it("type mapping identity", () => {
		const rows = [{ id: "33333333-3333-3333-3333-333333333333", type: "decision", content: "decide", scope: "project", createdAt: "2026-01-01 00:00:00" } as unknown as Memory];
		const env = toMif(rows, { redactPii: false });
		expect(env.memories[0].type).toBe("decision");
	});
});
