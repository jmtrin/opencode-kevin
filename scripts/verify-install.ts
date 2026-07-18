import { execSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
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
	const sqlSrc = join(process.cwd(), "migrations", "001_initial.sql");
	const sql003Src = join(process.cwd(), "migrations", "003_v02_signal.sql");
	if (!existsSync(sqlSrc)) {
		console.log("\u2717 No existe migrations/001_initial.sql");
		failed++;
		process.exit(1);
	}
	copyFileSync(sqlSrc, join(migrationsDir, "001_initial.sql"));
	if (existsSync(sql003Src)) {
		copyFileSync(sql003Src, join(migrationsDir, "003_v02_signal.sql"));
	}

	const store = new Store({ path: ":memory:" });
	try {
		check("SQLite (better-sqlite3) abre DB", () => {
			store.prepare("SELECT 1").get();
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

		check("TypeScript strict (tsc --noEmit)", () => {
			execSync("npx tsc --noEmit", { stdio: "pipe", cwd: process.cwd() });
		});
	} finally {
		store.close();
		rmSync(tmp, { recursive: true, force: true });
	}

	console.log(`\n${passed} pasaron, ${failed} fallaron.`);
	if (failed > 0) process.exit(1);
}

await main();
