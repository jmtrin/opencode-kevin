import { execSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextInjector } from "../plugin/ContextInjector.js";
import { MemoryService } from "../plugin/MemoryService.js";
import { Migrate } from "../plugin/Migrate.js";
import { Reflector } from "../plugin/Reflector.js";
import { Store } from "../plugin/Store.js";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
	try {
		fn();
		passed++;
		console.log(`\u2713 ${name}`);
	} catch (e) {
		failed++;
		console.log(`\u2717 ${name}`);
		console.log(`  ${(e as Error).message}`);
	}
}

async function checkAsync(
	name: string,
	fn: () => Promise<void>,
): Promise<void> {
	try {
		await fn();
		passed++;
		console.log(`\u2713 ${name}`);
	} catch (e) {
		failed++;
		console.log(`\u2717 ${name}`);
		console.log(`  ${(e as Error).message}`);
	}
}

async function main(): Promise<void> {
	console.log("Kevin - verify install\n");

	check("Node >= 20", () => {
		const major = Number.parseInt(
			process.versions.node.split(".")[0] ?? "0",
			10,
		);
		if (major < 20)
			throw new Error(`Node ${process.versions.node} (requerido >= 20)`);
	});

	const tmp = mkdtempSync(join(tmpdir(), "kevin-verify-"));
	const migrationsDir = join(tmp, "migrations");
	mkdirSync(migrationsDir, { recursive: true });

	// v0.9.0 (K9-021 / plan §8.11) — read migrations/ dynamically, no
	// hard-coded list; floor = 6 migrations as of this release.
	const srcMigrations = process.env.MIGRATIONS_DIR
		? join(process.env.MIGRATIONS_DIR)
		: join(process.cwd(), "migrations");
	let sqlFiles: string[];
	try {
		sqlFiles = readdirSync(srcMigrations)
			.filter((f) => f.endsWith(".sql"))
			.sort();
	} catch {
		console.error(
			"Floor check failed: migrations directory not found or unreadable",
		);
		process.exit(1);
	}
	if (sqlFiles.length < 6) {
		console.error(
			`Floor check failed: expected at least 6 migration files, found ${sqlFiles.length}`,
		);
		process.exit(1);
	}
	// v1.0.0 (K10-022 / plan §5.5) — 002_indexes.sql was absent from every
	// hard-coded list for six releases; its presence is asserted explicitly
	// so deleting any migration fails loudly instead of silently migrating
	// less.
	if (!sqlFiles.includes("002_indexes.sql")) {
		console.error("Floor check failed: 002_indexes.sql is missing");
		process.exit(1);
	}
	for (const f of sqlFiles) {
		copyFileSync(join(srcMigrations, f), join(migrationsDir, f));
	}

	const store = new Store({ path: ":memory:" });
	try {
		check("SQLite (better-sqlite3) abre DB", () => {
			store.prepare("SELECT 1").get();
		});

		// v0.9.0 (K9-021) — count check uses the dynamic list; no explicit
		// per-migration checks since the dynamic copy covers all.
		check(`${sqlFiles.length} migraciones copiadas`, () => {
			const files = readdirSync(migrationsDir).filter((f) =>
				f.endsWith(".sql"),
			);
			if (files.length !== sqlFiles.length) {
				throw new Error(
					`esperadas ${sqlFiles.length} migraciones, encontradas ${files.length}: ${files.join(", ")}`,
				);
			}
		});

		await checkAsync("Migracion 001 aplica", async () => {
			await new Migrate(store, migrationsDir).run();
			const row = store
				.prepare("SELECT COUNT(*) as c FROM schema_version")
				.get() as {
				c: number;
			};
			if (row.c < 1) throw new Error("schema_version vacia");
		});

		const memoryService = new MemoryService(store);
		// v0.6.0 (K6-022) — the release floor (0.6) blocks this single
		// observation, so the verify harness opts out to keep proving the
		// injection pipeline end to end (same contract as the legacy
		// plugin harnesses).
		store
			.prepare(
				"INSERT OR REPLACE INTO kevin_settings (key, value) VALUES ('injection_confidence_floor', '0')",
			)
			.run();

		check("MemoryService.save + query", () => {
			const id = memoryService.save({
				type: "error",
				content: "verify typecheck error de prueba",
				scope: "project",
			});
			if (!id) throw new Error("save retorno id vacio");
			const results = memoryService.query({
				text: "typecheck",
				limit: 10,
				full: true,
			});
			if (!results.some((m) => m.content.includes("typecheck")))
				throw new Error("query no encontro la memoria");
		});

		const reflector = new Reflector(memoryService);
		await checkAsync("Reflector.invoke genera memoria error", async () => {
			const id = await reflector.invoke({
				toolName: "bash",
				argsSummary: "command: npm run typecheck",
				stderr: "error TS2304: Cannot find name 'foo'",
				stdout: "",
				errorType: "typecheck",
				sessionId: "verify-sess",
			});
			if (!id) throw new Error("Reflector retorno null");
			const mem = memoryService.getById(id);
			if (!mem || mem.type !== "error")
				throw new Error("memoria no persistida como error");
			if (!mem.content.includes("Verify types and imports"))
				throw new Error("memoria sin leccion heuristica");
		});

		const injector = new ContextInjector(memoryService);
		await checkAsync("ContextInjector inyecta <kevin-context>", async () => {
			const output = { system: [] as string[] };
			await injector.onSystemTransform(
				{
					sessionID: "verify-sess",
					messages: [{ role: "user", content: "fix the typecheck error" }],
				},
				output,
			);
			if (output.system.length === 0) throw new Error("no inyecto nada");
			if (!output.system[0].includes("<kevin-context>"))
				throw new Error("falta tag <kevin-context>");
		});

		// v1.0.0 (K10-022 / plan §5.5) — the Bun smoke joins `verify` for the
		// first time. Without Bun installed the check is skipped with a printed
		// notice and a zero exit; with Bun present it must pass.
		function bunAvailable(): boolean {
			try {
				execSync("bun --version", { stdio: "pipe" });
				return true;
			} catch {
				return false;
			}
		}

		if (bunAvailable()) {
			await checkAsync("Bun smoke (bun:sqlite)", async () => {
				execSync("bun scripts/smoke-bun.ts", {
					stdio: "pipe",
					cwd: process.cwd(),
				});
			});
		} else {
			console.log("\u21b7 Bun smoke omitido (bun no disponible)");
		}

		check("TypeScript strict (tsc --noEmit)", () => {
			execSync("npx tsc --noEmit", { stdio: "pipe", cwd: process.cwd() });
		});
	} finally {
		store.close();
		rmSync(tmp, { recursive: true, force: true });
	}

	console.log(`\n${passed} pasaron, ${failed} fallaron.`);
	if (failed > 0) throw new Error("verification failed");
}

await main();
