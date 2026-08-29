import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import { exportMarkdown, exportOkf } from "@jmtrin/kevin-core";

/**
 * K8-027 / plan §5.3 — the v1 export is scoped to one project. The
 * global database can hold several projects' memories; a committed
 * export must not leak another project's knowledge. Both query paths
 * (primary with recurrence_count, legacy pre-005 fallback) are covered.
 */
describe("K8-027 — v1 export scoped to the requesting project", () => {
	function makeStore(with005: boolean): Store {
		const store = new Store({ path: ":memory:" });
		store.exec(
			readFileSync(
				join(process.cwd(), "packages/core/migrations", "001_initial.sql"),
				"utf8",
			),
		);
		store.exec(
			readFileSync(
				join(process.cwd(), "packages/core/migrations", "003_v02_signal.sql"),
				"utf8",
			),
		);
		store.exec(
			readFileSync(
				join(process.cwd(), "packages/core/migrations", "004_v03_knowledge.sql"),
				"utf8",
			),
		);
		if (with005) {
			store.exec(
				readFileSync(
					join(process.cwd(), "packages/core/migrations", "005_v04_signal.sql"),
					"utf8",
				),
			);
		}
		return store;
	}

	function seed(
		service: MemoryService,
		projectId: string,
		marker: string,
	): void {
		service.save({
			type: "rule",
			content: `${marker}: only ${projectId} may export me`,
			scope: "project",
			projectId,
			evidenceCount: 1,
		});
	}

	it("the primary path exports only the requested project's entries", () => {
		const store = makeStore(true);
		const service = new MemoryService(store);
		seed(service, "proj-a", "alpha-rule");
		seed(service, "proj-b", "beta-rule");

		const bundle = exportOkf(store, "proj-a");

		expect(bundle).toContain("alpha-rule");
		expect(bundle).not.toContain("beta-rule");
		store.close();
	});

	it("the legacy pre-005 fallback path is scoped too", () => {
		const store = makeStore(false);
		const service = new MemoryService(store);
		seed(service, "proj-a", "alpha-rule");
		seed(service, "proj-b", "beta-rule");

		const bundle = exportOkf(store, "proj-a");

		expect(bundle).toContain("alpha-rule");
		expect(bundle).not.toContain("beta-rule");
		store.close();
	});

	it("the markdown export is scoped too", () => {
		const store = makeStore(true);
		const service = new MemoryService(store);
		seed(service, "proj-a", "alpha-rule");
		seed(service, "proj-b", "beta-rule");

		const md = exportMarkdown(store, "proj-a");

		expect(md).toContain("alpha-rule");
		expect(md).not.toContain("beta-rule");
		store.close();
	});
});
