import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HookLiveness } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

describe("K11-015 HookLiveness arity guard", () => {
	it("slices excess args to 2 and increments excessArityCount", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, join(process.cwd(), "packages/core/migrations")).run();
		const hl = new HookLiveness(store, {
			enabled: true,
			thresholdText: "3",
			pluginVersion: "1.1.0",
		});
		let received: unknown[] = [];
		const hooks = hl.wrap({
			"tool.execute.after": async (...args: unknown[]) => {
				received = args;
			},
		});
		// Call with 3 args, expect only first 2 passed
		await (hooks as Record<string, (...a: unknown[]) => Promise<unknown>>)[
			"tool.execute.after"
		]("a", "b", "c");
		expect(received).toEqual(["a", "b"]);
		expect(hl.excessArityCount).toBe(1);
		// second call with 2 args should not increment
		await (hooks as Record<string, (...a: unknown[]) => Promise<unknown>>)[
			"tool.execute.after"
		]("x", "y");
		expect(hl.excessArityCount).toBe(1);
		store.close();
	});

	it("does not increment for compliant arity", async () => {
		const store = new Store({ path: ":memory:" });
		await new Migrate(store, join(process.cwd(), "packages/core/migrations")).run();
		const hl = new HookLiveness(store, {
			enabled: true,
			thresholdText: "3",
			pluginVersion: "1.1.0",
		});
		const hooks = hl.wrap({
			"tool.execute.after": async (a: unknown, b: unknown) => {
				return [a, b];
			},
		});
		await (hooks as Record<string, (...a: unknown[]) => Promise<unknown>>)[
			"tool.execute.after"
		]("a", "b");
		expect(hl.excessArityCount).toBe(0);
		store.close();
	});
});
