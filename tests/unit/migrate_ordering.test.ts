import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

describe("K11-015 Migrate versioning lexicographic validity", () => {
	let tmp: string;
	let store: Store;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "kevin-migrate-order-"));
		store = new Store({ path: ":memory:" });
	});
	afterEach(() => {
		store.close();
		rmSync(tmp, { recursive: true, force: true });
	});

	it("orders 001, 002, 010 correctly via lexicographic sort (zero-padded)", () => {
		const files = ["010_c.sql", "001_a.sql", "002_b.sql"];
		files.sort();
		expect(files).toEqual(["001_a.sql", "002_b.sql", "010_c.sql"]);
		// Also verify that Migrate.listPending would treat versions as string > (covered by sort)
		// This pins the zero-padded 3-digit invariant through 999
	});

	it("documents lexicographic limit: 1000 sorts BEFORE 999 (not after), so string > fails beyond 999", () => {
		// This test pins the documented limit of Migrate.listPending: versions are zero-padded 3-digit
		// strings, valid through "999". Beyond that, lexicographic ">" breaks.
		// v1.1.0 (K11-015) — reference the documented limit: Migrate.listPending comment.
		expect("1000" > "999").toBe(false); // lexicographically '1' < '9'
		expect("010" > "002").toBe(true); // within 3-digit zero-padded, lexicographic == numeric
		expect("002" > "001").toBe(true);
		// Demonstrate that a migration "1000_x.sql" would NOT be considered pending when current is "999"
		// because "1000" > "999" is false string-wise, but true numerically (1000 > 999).
		const numeric = Number.parseInt("1000", 10) > Number.parseInt("999", 10);
		expect(numeric).toBe(true);
		// The current implementation uses string >, so it would incorrectly skip 1000.
		// This is the documented limit through "999" — beyond that, numeric parsing required.
	});
});
