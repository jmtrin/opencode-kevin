import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../../plugin/Store.js";
import { ToolCallObserver } from "../../plugin/ToolCallObserver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);

let tmpRoot: string;
let store: Store;
let observer: ToolCallObserver;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-tco-private-"));
	store = new Store({ path: ":memory:" });
	store.exec(SQL_001);
	store.exec(SQL_003);
	observer = new ToolCallObserver(store);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

interface ToolCallRow {
	id: string;
	tool: string;
	args_summary: string;
	metadata: string;
	error_type: string | null;
	success: number;
}

function fetchRow(sessionId: string): ToolCallRow {
	return store
		.prepare(
			"SELECT id, tool, args_summary, metadata, error_type, success FROM tool_calls WHERE session_id = ? ORDER BY ts DESC LIMIT 1",
		)
		.get(sessionId) as ToolCallRow;
}

describe("ToolCallObserver — stripPrivate sweep (K2-009)", () => {
	it("strips <private> blocks from string arg values before persisting args_summary", () => {
		observer.onBefore({ tool: "bash", sessionId: "s1" }, {});
		observer.onAfter(
			{
				tool: "bash",
				sessionId: "s1",
				args: { command: "echo <private>hunter2</private>" },
			},
			{ success: true, stdout: "", stderr: "" },
		);
		const row = fetchRow("s1");
		expect(row.args_summary).toContain(
			"command: echo <private: redacted 7 chars>",
		);
		expect(row.args_summary).not.toContain("hunter2");
		expect(row.args_summary).not.toMatch(/<private>/);
	});

	it("strips <private> blocks from metadata JSON", () => {
		observer.onBefore({ tool: "bash", sessionId: "s2" }, {});
		observer.onAfter(
			{
				tool: "bash",
				sessionId: "s2",
				args: { command: "echo <private>SECRET</private>" },
			},
			{ success: true, stdout: "", stderr: "" },
		);
		const row = fetchRow("s2");
		const meta = JSON.parse(row.metadata) as { command: string };
		expect(meta.command).toContain("<private: redacted 6 chars>");
		expect(meta.command).not.toContain("SECRET");
	});

	it("strips <private> blocks from failure stderr before inferErrorType consults them", () => {
		observer.onBefore({ tool: "bash", sessionId: "s3" }, {});
		// typecheck signature is fully wrapped in <private>, so inferErrorType
		// should NOT see "error TS" and should fall through.
		observer.onAfter(
			{ tool: "bash", sessionId: "s3" },
			{
				success: false,
				stdout: "",
				stderr: "<private>error TS2304: cannot find name 'foo'.</private>",
				exitCode: 1,
			},
		);
		const row = fetchRow("s3");
		expect(row.error_type).not.toBe("typecheck");
		expect(row.error_type).toBe("unknown");
	});

	it("preserves typecheck detection when stderr is NOT wrapped in <private>", () => {
		observer.onBefore({ tool: "bash", sessionId: "s4" }, {});
		observer.onAfter(
			{ tool: "bash", sessionId: "s4" },
			{
				success: false,
				stdout: "",
				stderr: "error TS2304: cannot find name 'foo'.",
				exitCode: 1,
			},
		);
		const row = fetchRow("s4");
		expect(row.error_type).toBe("typecheck");
	});

	it("strips <private> blocks nested inside an array arg", () => {
		observer.onBefore({ tool: "bash", sessionId: "s5" }, {});
		observer.onAfter(
			{
				tool: "bash",
				sessionId: "s5",
				args: { items: ["x", "<private>top-secret</private>", "y"] },
			},
			{ success: true, stdout: "", stderr: "" },
		);
		const row = fetchRow("s5");
		expect(row.args_summary).toContain("<private: redacted 10 chars>");
		expect(row.args_summary).not.toContain("top-secret");
	});

	it("strips <private> blocks inside nested object arg", () => {
		observer.onBefore({ tool: "bash", sessionId: "s6" }, {});
		observer.onAfter(
			{
				tool: "bash",
				sessionId: "s6",
				args: { nested: { note: "<private>shhh</private>" } },
			},
			{ success: true, stdout: "", stderr: "" },
		);
		const row = fetchRow("s6");
		const meta = JSON.parse(row.metadata) as { nested: { note: string } };
		expect(meta.nested.note).toBe("<private: redacted 4 chars>");
	});

	it("leaves ordinary args untouched", () => {
		observer.onBefore({ tool: "bash", sessionId: "s7" }, {});
		observer.onAfter(
			{ tool: "bash", sessionId: "s7", args: { command: "ls -la /tmp" } },
			{ success: true, stdout: "", stderr: "" },
		);
		const row = fetchRow("s7");
		expect(row.args_summary).toContain("command: ls -la");
	});

	it("still applies redactPaths and redactSecrets alongside stripPrivate (chain order)", () => {
		observer.onBefore({ tool: "bash", sessionId: "s8" }, {});
		observer.onAfter(
			{
				tool: "bash",
				sessionId: "s8",
				args: {
					command:
						"API_KEY=hunter2 <private>C:\\Users\\me\\secret</private> done",
				},
			},
			{ success: true, stdout: "", stderr: "" },
		);
		const row = fetchRow("s8");
		expect(row.args_summary).toMatch(/<private: redacted \d+ chars>/);
		expect(row.args_summary).not.toContain("C:\\Users\\me\\secret");
		expect(row.args_summary).toContain("API_KEY=<redacted>");
		expect(row.args_summary).not.toContain("hunter2");
	});
});
