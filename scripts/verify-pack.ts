// K13-014 — verify packed artifacts for BOTH tarballs + consumer install smoke.
// Replaces the v1.0.0 single-package script; now orchestrates core + plugin packs.
import { execSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function fail(property: number | string, message: string): never {
	console.error(`✗ Property ${String(property)} FAILED: ${message}`);
	process.exit(1);
}
function pass(property: number | string, message: string): void {
	console.log(`✓ Property ${String(property)} — ${message}`);
}

const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const corePkgDir = join(root, "packages/core");
const pluginPkgDir = join(root, "packages/plugin");
const tuiPkgDir = join(root, "packages/tui");

if (!existsSync(join(corePkgDir, "package.json"))) fail("init", "packages/core/package.json missing");
if (!existsSync(join(pluginPkgDir, "package.json"))) fail("init", "packages/plugin/package.json missing");

function pack(cwd: string, label: string): { tarballPath: string; tmpExtractRoot: string; pkgDir: string } {
	const tmpExtractRoot = mkdtempSync(join(tmpdir(), `kevin-verify-pack-${label}-`));
	let tarballPath = "";
	try {
		const out = execSync("npm pack --json", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		let parsed: Array<{ filename: string }>;
		try {
			parsed = JSON.parse(out);
		} catch {
			console.error(out);
			throw new Error(`npm pack --json for ${label} did not return valid JSON`);
		}
		const filename = parsed[0]?.filename;
		if (!filename) throw new Error(`npm pack for ${label} returned no filename`);
		tarballPath = join(cwd, filename);
	} catch (e) {
		rmSync(tmpExtractRoot, { recursive: true, force: true });
		throw e;
	}
	// Extract
	try {
		execSync(`tar -xzf "${tarballPath}" -C "${tmpExtractRoot}"`, { stdio: "pipe" });
	} catch (e) {
		// fallback via node tar? try powershell Expand-Archive style fallback — but tar should exist via git
		console.error(`tar extraction failed for ${label}:`, (e as Error).message);
		throw e;
	}
	const pkgDir = join(tmpExtractRoot, "package");
	if (!existsSync(pkgDir)) fail(`${label}:1`, "extracted package/ directory missing");
	return { tarballPath, tmpExtractRoot, pkgDir };
}

function assertNoMaps(pkgDir: string, label: string, prop: string): void {
	const maps: string[] = [];
	function walk(dir: string) {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".js.map")) maps.push(p);
		}
	}
	walk(pkgDir);
	if (maps.length > 0) fail(prop, `${label}: ${maps.length} .js.map file(s) present: ${maps[0]}`);
	function walkJs(dir: string) {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) walkJs(p);
			else if (e.name.endsWith(".js")) {
				const c = readFileSync(p, "utf8");
				if (c.includes("sourceMappingURL")) fail(prop, `${label}: ${p} contains sourceMappingURL but no maps should be present`);
			}
		}
	}
	walkJs(pkgDir);
	pass(prop, `${label}: no .js.map and no sourceMappingURL`);
}

function assertNoTestsOrScripts(pkgDir: string, label: string, prop: string): void {
	if (existsSync(join(pkgDir, "dist", "tests"))) fail(prop, `${label}: dist/tests/ present in tarball`);
	// plugin dist is dist/plugin/tests — also block any tests folder
	function walkForTests(dir: string): boolean {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name === "tests" || e.name === "scripts") return true;
				if (walkForTests(p)) return true;
			}
		}
		return false;
	}
	if (existsSync(join(pkgDir, "dist")) && walkForTests(join(pkgDir, "dist"))) fail(prop, `${label}: dist/tests/ or dist/scripts/ present`);
	if (existsSync(join(pkgDir, "dist", "scripts"))) fail(prop, `${label}: dist/scripts/ present`);
	pass(prop, `${label}: no dist/tests/ or dist/scripts/`);
}

// ---------- CORE ----------
console.log("=== Verifying @jmtrin/kevin-core ===");
const core = pack(corePkgDir, "core");
let coreTarballPath = core.tarballPath;
let coreTmpRoot = core.tmpExtractRoot;
const corePkgDirExtracted = core.pkgDir;
try {
	const pkgJson = JSON.parse(readFileSync(join(corePkgDirExtracted, "package.json"), "utf8")) as {
		name?: string;
		main?: string;
		types?: string;
		exports?: Record<string, Record<string, string>>;
		files?: string[];
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
		version?: string;
	};

	// C1: name/version
	if (pkgJson.name !== "@jmtrin/kevin-core") fail("C1", `core name is "${pkgJson.name}" expected "@jmtrin/kevin-core"`);
	if (pkgJson.version !== "1.5.0") fail("C1", `core version is "${pkgJson.version}" expected "1.5.0"`);
	pass("C1", "core name @jmtrin/kevin-core version 1.5.0");

	// C2: exports/main/types exist
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
			const p = join(corePkgDirExtracted, t);
			if (!existsSync(p)) fail("C2", `core target ${t} does not exist in tarball`);
		}
		pass("C2", `core all ${targets.length} export targets exist`);
	}

	// C3: types first
	{
		const expDot = pkgJson.exports?.["."];
		if (!expDot) fail("C3", 'core exports["."] missing');
		const keys = Object.keys(expDot as object);
		if (keys[0] !== "types") fail("C3", `core first exports condition is "${keys[0]}" expected "types"`);
		pass("C3", `core exports["."] first key is "types" (${keys.join(",")})`);
	}

	// C4: files field
	{
		const files: string[] = pkgJson.files ?? [];
		if (!files.includes("dist")) fail("C4", `core files field ${JSON.stringify(files)} does not include "dist"`);
		pass("C4", `core files includes dist (${files.join(",")})`);
	}

	assertNoMaps(corePkgDirExtracted, "core", "C5");
	assertNoTestsOrScripts(corePkgDirExtracted, "core", "C6");

	// C7: zero deps
	{
		const depBlocks: Array<{ label: string; obj?: Record<string, string> }> = [
			{ label: "dependencies", obj: pkgJson.dependencies },
			{ label: "devDependencies", obj: pkgJson.devDependencies },
			{ label: "peerDependencies", obj: pkgJson.peerDependencies },
			{ label: "optionalDependencies", obj: pkgJson.optionalDependencies },
		];
		for (const b of depBlocks) {
			if (b.obj && Object.keys(b.obj).length > 0) {
				fail("C7", `core ${b.label} not empty: ${JSON.stringify(b.obj)}`);
			}
		}
		pass("C7", "core zero deps (no dependencies/peer/optional/dev)");
	}

	// C8: dist/migrations complete, root migrations not packed
	{
		const repoMigrations = readdirSync(join(root, "packages/core/migrations"))
			.filter((f) => f.endsWith(".sql"))
			.sort();
		const distMigrationsDir = join(corePkgDirExtracted, "dist", "migrations");
		if (!existsSync(distMigrationsDir)) fail("C8", "core dist/migrations/ missing in tarball");
		const packed = readdirSync(distMigrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort();
		if (packed.length !== repoMigrations.length || packed.some((v, i) => v !== repoMigrations[i])) {
			fail("C8", `core dist/migrations mismatch: repo [${repoMigrations.join(",")}] vs packed [${packed.join(",")}]`);
		}
		if (existsSync(join(corePkgDirExtracted, "migrations"))) fail("C8", "core root migrations/ should not be packed");
		pass("C8", `core dist/migrations/ has ${packed.length} files, root migrations/ absent`);
	}

	// C9: Migrate against packed migrations succeeds
	{
		const repoMigrations = readdirSync(join(root, "packages/core/migrations"))
			.filter((f) => f.endsWith(".sql"))
			.sort();
		const packedDir = join(corePkgDirExtracted, "dist", "migrations");
		const packedList = readdirSync(packedDir)
			.filter((f) => f.endsWith(".sql"))
			.sort();
		if (packedList.join(",") !== repoMigrations.join(",")) fail("C9", "core packed enumeration differs from repo");
		const { pathToFileURL } = await import("node:url");
		// Migrate lives in core dist after build
		const { Store } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
		const { Migrate } = await import(pathToFileURL(join(root, "packages/core/dist/Migrate.js")).href);
		const tmpDbDir = mkdtempSync(join(tmpdir(), "kevin-migrate-verify-core-"));
		const dbPath = join(tmpDbDir, "test.db");
		let store: InstanceType<typeof Store> | undefined;
		try {
			store = new Store({ path: dbPath });
			const m = new Migrate(store, packedDir);
			await m.run();
			const res2 = await m.run();
			if (res2.applied.length !== 0) fail("C9", "core second Migrate.run() should be no-op");
		} finally {
			try { store?.close(); } catch {}
			rmSync(tmpDbDir, { recursive: true, force: true });
		}
		pass("C9", "core Migrate against packed dist/migrations succeeds and is idempotent");
	}

	console.log("Core tarball: all checks passed.\n");
} catch (e) {
	if ((e as { message?: string })?.message?.includes("FAILED")) throw e;
	console.error(e);
	process.exit(1);
}

// ---------- PLUGIN ----------
console.log("=== Verifying @jmtrin/opencode-kevin ===");
const plugin = pack(pluginPkgDir, "plugin");
let pluginTarballPath = plugin.tarballPath;
let pluginTmpRoot = plugin.tmpExtractRoot;
const pluginPkgDirExtracted = plugin.pkgDir;
try {
	const pkgJson = JSON.parse(readFileSync(join(pluginPkgDirExtracted, "package.json"), "utf8")) as {
		name?: string;
		main?: string;
		types?: string;
		exports?: Record<string, Record<string, string> | string>;
		files?: string[];
		dependencies?: Record<string, string>;
		version?: string;
	};

	// P1: name/main/types unchanged
	if (pkgJson.name !== "@jmtrin/opencode-kevin") fail("P1", `plugin name is "${pkgJson.name}" expected "@jmtrin/opencode-kevin"`);
	if (pkgJson.main !== "dist/plugin/index.js") fail("P1", `plugin main is "${pkgJson.main}" expected "dist/plugin/index.js"`);
	if (pkgJson.types !== "dist/plugin/index.d.ts") fail("P1", `plugin types is "${pkgJson.types}" expected "dist/plugin/index.d.ts"`);
	if (pkgJson.version !== "1.5.0") fail("P1", `plugin version is "${pkgJson.version}" expected "1.5.0"`);
	pass("P1", "plugin name/main/types verbatim (C-06) and version 1.5.0");

	// P2: exports exist
	{
		const targets: string[] = [];
		if (pkgJson.main) targets.push(pkgJson.main);
		if (pkgJson.types) targets.push(pkgJson.types);
		if (pkgJson.exports) {
			for (const [k, exp] of Object.entries(pkgJson.exports)) {
				if (typeof exp === "object" && exp !== null) {
					for (const v of Object.values(exp as Record<string, string>)) {
						// skip bare specifier targets like @jmtrin/opencode-kevin-tui/dist — not file in this tarball
						if (typeof v === "string" && !v.startsWith("@")) targets.push(v);
					}
				} else if (typeof exp === "string" && !exp.startsWith("@")) targets.push(exp);
			}
		}
		for (const t of targets) {
			const p = join(pluginPkgDirExtracted, t);
			if (!existsSync(p)) fail("P2", `plugin target ${t} does not exist in tarball`);
		}
		pass("P2", `plugin all ${targets.length} local export targets exist`);
	}

	// P3: types first for "." and "./tui"
	{
		const expDot = pkgJson.exports?.["."] as Record<string, string> | undefined;
		if (!expDot) fail("P3", 'plugin exports["."] missing');
		const keys = Object.keys(expDot as object);
		if (keys[0] !== "types") fail("P3", `plugin first exports["."] condition is "${keys[0]}" expected "types"`);
		pass("P3", `plugin exports["."] first key is "types" (${keys.join(",")})`);
		const expTui = pkgJson.exports?.["./tui"] as Record<string, string> | undefined;
		if (!expTui) fail("P3", 'plugin exports["./tui"] missing');
		const tuiKeys = Object.keys(expTui as object);
		if (tuiKeys[0] !== "types") fail("P3", `plugin exports["./tui"] first key is "${tuiKeys[0]}" expected "types"`);
		// Must point to tui package
		const tuiImport = (expTui as Record<string, string>)["import"];
		if (tuiImport !== "@jmtrin/opencode-kevin-tui/dist/index.js") fail("P3", `plugin exports["./tui"] import is "${tuiImport}" expected "@jmtrin/opencode-kevin-tui/dist/index.js"`);
		const tuiTypes = (expTui as Record<string, string>)["types"];
		if (tuiTypes !== "@jmtrin/opencode-kevin-tui/dist/index.d.ts") fail("P3", `plugin exports["./tui"] types is "${tuiTypes}" expected "@jmtrin/opencode-kevin-tui/dist/index.d.ts"`);
		pass("P3", `plugin exports["./tui"] types-first and points to tui package`);
	}

	// P4: deps pin exact 1.5.0
	{
		const corePin = pkgJson.dependencies?.["@jmtrin/kevin-core"];
		if (corePin !== "1.5.0") fail("P4", `plugin @jmtrin/kevin-core dep is "${corePin}" expected exact "1.5.0"`);
		const tuiPin = pkgJson.dependencies?.["@jmtrin/opencode-kevin-tui"];
		if (tuiPin !== "1.5.0") fail("P4", `plugin @jmtrin/opencode-kevin-tui dep is "${tuiPin}" expected "1.5.0"`);
		pass("P4", "plugin deps pin @jmtrin/kevin-core and tui at 1.5.0 exact");
	}

	// P5: no sql inside plugin tarball
	{
		function walkForSql(dir: string): string[] {
			const out: string[] = [];
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, e.name);
				if (e.isDirectory()) out.push(...walkForSql(p));
				else if (e.name.endsWith(".sql")) out.push(p);
			}
			return out;
		}
		const sqls = walkForSql(pluginPkgDirExtracted);
		if (sqls.length > 0) fail("P5", `plugin tarball contains ${sqls.length} .sql file(s): ${sqls[0]}`);
		if (existsSync(join(pluginPkgDirExtracted, "dist", "migrations"))) fail("P5", "plugin dist/migrations/ should not exist");
		pass("P5", "plugin no .sql, no dist/migrations");
	}

	assertNoMaps(pluginPkgDirExtracted, "plugin", "P6");
	assertNoTestsOrScripts(pluginPkgDirExtracted, "plugin", "P7");

	console.log("Plugin tarball: all checks passed.\n");
} catch (e) {
	if ((e as { message?: string })?.message?.includes("FAILED")) throw e;
	console.error(e);
	process.exit(1);
}

// Pack TUI as well for consumer install — plugin depends on it but it is not on registry yet
const tui = pack(tuiPkgDir, "tui");
let tuiTarballPath = tui.tarballPath;
let tuiTmpRoot = tui.tmpExtractRoot;
console.log(`TUI tarball packed: ${tuiTarballPath}\n`);

// ---------- CONSUMER INSTALL SMOKE ----------
console.log("=== Consumer install smoke (plugin → core linkage) ===");
let consumerTmp = "";
let consumerTarballCleanup = true;
try {
	consumerTmp = mkdtempSync(join(tmpdir(), "kevin-consumer-"));
	// minimal package.json
	writeFileSync(join(consumerTmp, "package.json"), JSON.stringify({ private: true, type: "module", name: "kevin-consumer-smoke", version: "1.0.0" }, null, 2));
	// Install all three tarballs offline; plugin will resolve core+tui via its deps but we install explicitly for offline determinism
	execSync(`npm install "${coreTarballPath}" "${tuiTarballPath}" "${pluginTarballPath}" --no-save --ignore-scripts --no-audit --no-fund`, { cwd: consumerTmp, stdio: "pipe" });
	pass("CS1", "consumer npm install core+plugin tarballs succeeded");

	// Write smoke script
	const smokePath = join(consumerTmp, "smoke.mjs");
	writeFileSync(smokePath, `
import { Store, Migrate, exportMigrationsDir } from "@jmtrin/kevin-core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// smoke 1: migrations via exportMigrationsDir + Migrate on temp db
const dir = exportMigrationsDir();
const tmp = mkdtempSync(join(tmpdir(), "kevin-consumer-db-"));
const dbPath = join(tmp, "smoke.db");
let store;
try {
  store = new Store({ path: dbPath });
  const m = new Migrate(store, dir);
  const r = await m.run();
  if (r.applied.length === 0) throw new Error("Migrate.run applied 0");
  const row = store.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get();
  if (!row || row.version !== "013") throw new Error("schema_version not 013: " + JSON.stringify(row));
  // smoke 2: plugin factory importable
  const plugin = await import("@jmtrin/opencode-kevin");
  if (!plugin.KevinPlugin && !plugin.default) throw new Error("KevinPlugin not exported");
  // smoke 3: kevin_status-like query with in-memory store
  const memStore = new Store({ path: ":memory:" });
  try {
    const m2 = new Migrate(memStore, dir);
    await m2.run();
    memStore.prepare("INSERT INTO memories (id, type, content, scope, project_id) VALUES (?, ?, ?, ?, ?)").run("test-id", "error", "smoke", "project", "p1");
    const c = memStore.prepare("SELECT COUNT(*) as c FROM memories").get();
    if (c.c !== 1) throw new Error("memory count mismatch");
  } finally { try { memStore.close(); } catch {} }
  console.log("SMOKE_OK");
} finally {
  try { store?.close(); } catch {}
  rmSync(tmp, { recursive: true, force: true });
}
`);

	execSync(`node "${smokePath}"`, { cwd: consumerTmp, stdio: "pipe", encoding: "utf8" });
	// re-run with output capture to verify marker
	const out = execSync(`node "${smokePath}"`, { cwd: consumerTmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (!out.includes("SMOKE_OK")) fail("CS2", "consumer smoke did not emit SMOKE_OK");
	pass("CS2", "consumer smoke: Migrate + plugin import + in-memory store passed");
	console.log("Consumer smoke: all checks passed.\n");
} catch (e) {
	console.error(e);
	const msg = (e as { stdout?: string; stderr?: string; message?: string })?.message ?? String(e);
	if (msg.includes("FAILED")) process.exit(1);
	// include stdout/stderr if execSync threw
	const stdout = (e as { stdout?: Buffer | string })?.stdout;
	const stderr = (e as { stderr?: Buffer | string })?.stderr;
	if (stdout) console.error(String(stdout).slice(0, 2000));
	if (stderr) console.error(String(stderr).slice(0, 2000));
	process.exit(1);
} finally {
	// cleanup tarballs, temps
	try { if (coreTarballPath && existsSync(coreTarballPath)) rmSync(coreTarballPath, { force: true }); } catch {}
	try { if (pluginTarballPath && existsSync(pluginTarballPath)) rmSync(pluginTarballPath, { force: true }); } catch {}
	try { if (tuiTarballPath && existsSync(tuiTarballPath)) rmSync(tuiTarballPath, { force: true }); } catch {}
	try { if (coreTmpRoot) rmSync(coreTmpRoot, { recursive: true, force: true }); } catch {}
	try { if (pluginTmpRoot) rmSync(pluginTmpRoot, { recursive: true, force: true }); } catch {}
	try { if (tuiTmpRoot) rmSync(tuiTmpRoot, { recursive: true, force: true }); } catch {}
	try { if (consumerTmp) rmSync(consumerTmp, { recursive: true, force: true }); } catch {}
}

console.log("\nAll verify-pack checks passed (core + plugin + consumer).");
