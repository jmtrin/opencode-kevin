import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const { KevinPlugin } = await import(
	pathToFileURL("C:/opencode-kevin/plugin/index.js").href
);

const tmpRoot = mkdtempSync(join(tmpdir(), "kevin-debug-"));
const migrationsDir = join(tmpRoot, "migrations");
mkdirSync(migrationsDir, { recursive: true });
for (const f of [
	"001_initial.sql",
	"003_v02_signal.sql",
	"004_v03_knowledge.sql",
	"005_v04_signal.sql",
]) {
	copyFileSync(join("C:/opencode-kevin/migrations", f), join(migrationsDir, f));
}
const hooks = await KevinPlugin(
	{ directory: tmpRoot },
	{
		dbPath: join(tmpRoot, "kevin.db"),
		migrationsDir,
		retrospectivesDir: join(tmpRoot, "retrospectives"),
	},
);

const RG_STDERR =
	"rg: The term 'rg' is not recognized as the name of a cmdlet, function, script file, or operable program.";

const sess = "s";
await hooks.event?.({
	event: { type: "session.created", properties: { info: { id: sess } } },
});
await hooks["tool.execute.before"]?.(
	{ tool: "bash", sessionID: sess, callID: "c1" },
	{ args: { command: "rg" } },
);
await hooks["tool.execute.after"]?.(
	{ tool: "bash", sessionID: sess, callID: "c1", args: { command: "rg" } },
	{
		title: "bash",
		output: "",
		metadata: { success: false, stderr: RG_STDERR, exitCode: 1 },
	},
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(300);

const ctx = {
	sessionID: sess,
	messageID: "m",
	agent: "test",
	directory: tmpRoot,
	worktree: tmpRoot,
	abort: new AbortController().signal,
	metadata() {},
	ask() {
		return Promise.resolve();
	},
};

for (const q of ["rg", "rg not recognized", "command not recognized", "term"]) {
	const r = await hooks.tool?.kevin_query.execute(
		{ query: q, limit: 5, full: true },
		ctx,
	);
	console.log(q, "→", r?.output?.slice(0, 200));
}
const st = await hooks.tool?.kevin_status.execute({}, ctx);
console.log("status:", st?.output);
process.exit(0);
