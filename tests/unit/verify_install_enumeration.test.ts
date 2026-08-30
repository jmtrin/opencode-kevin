import { spawn } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmpRoot: string;
let migrationsDir: string;

const REAL_MIGRATIONS = join(process.cwd(), "packages/core/migrations");

function runVerify(
	migrationsPath: string,
): Promise<{ stdout: string; exitCode: number }> {
	return new Promise((resolve) => {
		const child = spawn("npx", ["tsx", "scripts/verify-install.ts"], {
			cwd: process.cwd(),
			env: { ...process.env, MIGRATIONS_DIR: migrationsPath },
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		child.on("close", (code) => {
			resolve({ stdout: stdout + stderr, exitCode: code ?? 1 });
		});
	});
}

function copyRealMigrations(targetDir: string): string[] {
	const sqlFiles = readdirSync(REAL_MIGRATIONS)
		.filter((f) => f.endsWith(".sql"))
		.sort();
	for (const f of sqlFiles) {
		copyFileSync(join(REAL_MIGRATIONS, f), join(targetDir, f));
	}
	return sqlFiles;
}

describe("K9-021 — verify-install.ts enumerates migrations/ (plan §8.11)", () => {
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "kevin-verify-enum-"));
		migrationsDir = join(tmpRoot, "packages/core/migrations");
		mkdirSync(migrationsDir, { recursive: true });
	}, 15000);

	afterEach(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("lists *.sql files sorted lexicographically from migrations/", async () => {
		copyRealMigrations(migrationsDir);
		const { stdout, exitCode } = await runVerify(migrationsDir);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("14 migraciones copiadas");
	}, 30000);

	it("floor check fails when fewer than 6 migration files", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), "-- initial");
		writeFileSync(join(migrationsDir, "002_indexes.sql"), "-- indexes");
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), "-- signal");

		const { stdout, exitCode } = await runVerify(migrationsDir);
		expect(exitCode).toBe(1);
		expect(stdout).toContain("Floor check failed");
	}, 30000);

	it("floor check fails when migrations directory does not exist", async () => {
		const nonexistent = join(tmpRoot, "no-such-dir");
		const { stdout, exitCode } = await runVerify(nonexistent);
		expect(exitCode).toBe(1);
		expect(stdout).toContain("Floor check failed");
	}, 30000);

	// v1.0.0 (K10-022) — deleting a migration fails loudly: 002_indexes.sql
	// was absent from hard-coded lists for six releases, so its presence is
	// asserted explicitly.
	it("fails loudly when 002_indexes.sql is missing", async () => {
		copyRealMigrations(migrationsDir);
		const { rmSync: rm } = await import("node:fs");
		rm(join(migrationsDir, "002_indexes.sql"), { force: true });
		const { stdout, exitCode } = await runVerify(migrationsDir);
		expect(exitCode).toBe(1);
		expect(stdout).toContain("002_indexes.sql is missing");
	}, 30000);

	it("copies exactly the *.sql files found, no more no less", async () => {
		copyRealMigrations(migrationsDir);
		writeFileSync(join(migrationsDir, "README.md"), "# not a sql file");
		writeFileSync(join(migrationsDir, "extra.txt"), "ignored");

		const { stdout, exitCode } = await runVerify(migrationsDir);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("14 migraciones copiadas");
	}, 30000);

	it("sorts files lexicographically so 010 comes after 009", async () => {
		copyRealMigrations(migrationsDir);

		const { stdout, exitCode } = await runVerify(migrationsDir);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("14 migraciones copiadas");
	}, 30000);

	it("matches the actual migrations/ directory floor on disk (6)", () => {
		const actualMigrations = readdirSync(REAL_MIGRATIONS).filter((f) =>
			f.endsWith(".sql"),
		).length;
		expect(actualMigrations).toBeGreaterThanOrEqual(6);
		expect(actualMigrations).toBe(14); // current state of repo (011_v10_proven since v1.0.0)
	});
});
