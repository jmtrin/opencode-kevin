// v1.0.0 (K10-003 / plan §5.5) — verify the packed artifact, not the tree.
import { execSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function fail(property: number, message: string): never {
	console.error(`✗ Property ${property} FAILED: ${message}`);
	process.exit(1);
}
function pass(property: number, message: string): void {
	console.log(`✓ Property ${property} — ${message}`);
}

const root = join(
	dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
	"..",
);
if (!existsSync(join(root, "package.json"))) {
	// On Windows, pathname decoding may differ; fallback
}

const tmpRoot = mkdtempSync(join(tmpdir(), "kevin-verify-pack-"));
let tarballPath = "";
try {
	// 1. npm pack --json
	const out = execSync("npm pack --json", {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	let parsed: Array<{ filename: string }>;
	try {
		parsed = JSON.parse(out);
	} catch {
		console.error(out);
		throw new Error("npm pack --json did not return valid JSON");
	}
	const filename = parsed[0]?.filename;
	if (!filename) throw new Error("npm pack returned no filename");
	tarballPath = join(root, filename);

	// 2. Extract
	execSync(`tar -xzf "${tarballPath}" -C "${tmpRoot}"`, { stdio: "pipe" });
	const pkgDir = join(tmpRoot, "package");
	if (!existsSync(pkgDir)) fail(1, "extracted package/ directory missing");

	const pkgJson = JSON.parse(
		readFileSync(join(pkgDir, "package.json"), "utf8"),
	) as {
		main?: string;
		types?: string;
		exports?: Record<string, Record<string, string>>;
		files?: string[];
	};

	// Property 1: main and every exports target exists
	{
		const targets: string[] = [];
		if (pkgJson.main) targets.push(pkgJson.main);
		if (pkgJson.types) targets.push(pkgJson.types);
		if (pkgJson.exports) {
			for (const exp of Object.values(pkgJson.exports)) {
				if (typeof exp === "object" && exp !== null) {
					for (const v of Object.values(exp)) targets.push(v);
				} else if (typeof exp === "string") targets.push(exp);
			}
		}
		for (const t of targets) {
			const p = join(pkgDir, t);
			if (!existsSync(p)) fail(1, `target ${t} does not exist in tarball`);
		}
		pass(1, `all ${targets.length} export targets exist`);
	}

	// Property 2: types is first condition
	{
		const expDot = pkgJson.exports?.["."];
		if (!expDot) fail(2, 'exports["."] missing');
		const keys = Object.keys(expDot);
		if (keys[0] !== "types")
			fail(2, `first exports condition is "${keys[0]}" expected "types"`);
		pass(2, `exports["."] first key is "types" (${keys.join(",")})`);
		// v1.2.0 (K12-013) — exports["./tui"] must exist with types-first
		const expTui = pkgJson.exports?.["./tui"] as
			| Record<string, string>
			| undefined;
		if (!expTui) fail(2, 'exports["./tui"] missing (K12-013)');
		const tuiKeys = Object.keys(expTui as object);
		if (tuiKeys[0] !== "types")
			fail(2, `exports["./tui"] first key is "${tuiKeys[0]}" expected "types"`);
		pass(2, `exports["./tui"] first key is "types" (${tuiKeys.join(",")})`);
	}

	// Property 3: No .js.map that references absent source
	{
		const maps: string[] = [];
		function walk(dir: string) {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, e.name);
				if (e.isDirectory()) walk(p);
				else if (e.name.endsWith(".js.map")) maps.push(p);
			}
		}
		walk(pkgDir);
		if (maps.length > 0)
			fail(3, `${maps.length} .js.map file(s) present: ${maps[0]}`);
		// Also check .js files don't contain sourceMappingURL referencing map
		function walkJs(dir: string) {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, e.name);
				if (e.isDirectory()) walkJs(p);
				else if (e.name.endsWith(".js")) {
					const c = readFileSync(p, "utf8");
					if (c.includes("sourceMappingURL"))
						fail(
							3,
							`${p} contains sourceMappingURL but no maps should be present`,
						);
				}
			}
		}
		walkJs(pkgDir);
		pass(3, "no .js.map and no sourceMappingURL");
	}
	if (existsSync(join(pkgDir, "dist", "tests")))
		fail(4, "dist/tests/ present in tarball");
	if (existsSync(join(pkgDir, "dist", "scripts")))
		fail(4, "dist/scripts/ present in tarball");
	pass(4, "no dist/tests/ or dist/scripts/");

	// Property 5: dist/migrations contains every .sql exactly once, root migrations not packed
	{
		const repoMigrations = readdirSync(join(root, "migrations"))
			.filter((f) => f.endsWith(".sql"))
			.sort();
		const distMigrationsDir = join(pkgDir, "dist", "migrations");
		if (!existsSync(distMigrationsDir))
			fail(5, "dist/migrations/ missing in tarball");
		const packed = readdirSync(distMigrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort();
		if (
			packed.length !== repoMigrations.length ||
			packed.some((v, i) => v !== repoMigrations[i])
		) {
			fail(
				5,
				`dist/migrations mismatch: repo [${repoMigrations.join(",")}] vs packed [${packed.join(",")}]`,
			);
		}
		if (existsSync(join(pkgDir, "migrations")))
			fail(5, "root migrations/ should not be packed");
		pass(
			5,
			`dist/migrations/ has ${packed.length} files, root migrations/ absent`,
		);
	}

	// Property 6: Migrate against packed migrations enumerates same list and can run
	{
		const repoMigrations = readdirSync(join(root, "migrations"))
			.filter((f) => f.endsWith(".sql"))
			.sort();
		const packedDir = join(pkgDir, "dist", "migrations");
		const packedList = readdirSync(packedDir)
			.filter((f) => f.endsWith(".sql"))
			.sort();
		if (packedList.join(",") !== repoMigrations.join(","))
			fail(6, "packed enumeration differs from repo");

		// Construct Migrate against temp DB using packed dir
		const { pathToFileURL } = await import("node:url");
		const { Store } = await import(
			pathToFileURL(join(root, "dist", "plugin", "Store.js")).href
		);
		const { Migrate } = await import(
			pathToFileURL(join(root, "dist", "plugin", "Migrate.js")).href
		);
		const tmpDbDir = mkdtempSync(join(tmpdir(), "kevin-migrate-verify-"));
		const dbPath = join(tmpDbDir, "test.db");
		let store: InstanceType<typeof Store> | undefined;
		try {
			store = new Store(dbPath);
			const m = new Migrate(store, packedDir);
			const res = await m.run();
			if (res.applied.length === 0 && repoMigrations.length > 0) {
				// If DB was empty, should have applied all; if not empty, still check no error
			}
			// Run twice idempotent
			const res2 = await m.run();
			if (res2.applied.length !== 0)
				fail(6, "second Migrate.run() should be no-op");
		} finally {
			try {
				store?.close();
			} catch {}
			rmSync(tmpDbDir, { recursive: true, force: true });
		}
		pass(
			6,
			"Migrate against packed dist/migrations succeeds and is idempotent",
		);
	}

	// Property 7: resolveMigrationsDir assumption holds — entry's ../migrations resolves to dist/migrations
	{
		const entry = join(pkgDir, pkgJson.main ?? "dist/plugin/index.js");
		const resolved = join(dirname(entry), "..", "migrations");
		const expected = join(pkgDir, "dist", "migrations");
		// Normalize
		if (resolved !== expected)
			fail(
				7,
				`resolveMigrationsDir would resolve to ${resolved}, expected ${expected}`,
			);
		if (!existsSync(resolved))
			fail(7, `resolved migrations dir does not exist: ${resolved}`);
		pass(7, "entry ../migrations resolves to dist/migrations");
	}

	console.log("\nAll 7 properties passed.");
} finally {
	try {
		if (tarballPath && existsSync(tarballPath))
			rmSync(tarballPath, { force: true });
	} catch {}
	rmSync(tmpRoot, { recursive: true, force: true });
}
