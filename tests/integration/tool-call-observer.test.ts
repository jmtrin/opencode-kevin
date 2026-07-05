import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Migrate } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";
import { ToolCallObserver } from "../../plugin/ToolCallObserver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SQL = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;
let observer: ToolCallObserver;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-obs-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	writeFileSync(join(migrationsDir, "001_initial.sql"), FIXTURE_SQL);
	store = new Store({ path: ":memory:" });
	void new Migrate(store, migrationsDir).run();
	observer = new ToolCallObserver(store);
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

function rowForSession(sessionId: string) {
	return store
		.prepare(
			"SELECT * FROM tool_calls WHERE session_id = ? ORDER BY ts DESC LIMIT 1",
		)
		.get(sessionId) as {
		id: string;
		session_id: string;
		tool: string;
		args_summary: string;
		success: number;
		duration_ms: number;
		agent: string | null;
		error_type: string | null;
		metadata: string;
	};
}

describe("ToolCallObserver — unit (redact, error_type, summarize)", () => {
	describe("redact", () => {
		it("redacts API_KEY=value", () => {
			expect(observer.redactSecrets("API_KEY=abc123")).toBe(
				"API_KEY=<redacted>",
			);
		});
		it("redacts SECRET=...", () => {
			expect(observer.redactSecrets("SECRET=supersecret")).toBe(
				"SECRET=<redacted>",
			);
		});
		it("redacts PASSWORD=...", () => {
			expect(observer.redactSecrets("PASSWORD=hunter2")).toBe(
				"PASSWORD=<redacted>",
			);
		});
		it("redacts Bearer token", () => {
			expect(observer.redactSecrets("Bearer xyz123")).toBe("Bearer <redacted>");
		});
		it("redacts token keyword", () => {
			expect(observer.redactSecrets("token abcde12345")).toBe(
				"token <redacted>",
			);
		});
		it("does not change clean text", () => {
			expect(observer.redactSecrets("npm install vitest")).toBe(
				"npm install vitest",
			);
		});
		it("redacts multiple occurrences in one string", () => {
			const out = observer.redactSecrets(
				"API_KEY=aaa and Bearer bbb and token ccc",
			);
			expect(out).toContain("API_KEY=<redacted>");
			expect(out).toContain("Bearer <redacted>");
			expect(out).toContain("token <redacted>");
			expect(out).not.toContain("aaa");
			expect(out).not.toContain("bbb");
			expect(out).not.toContain("ccc");
		});
		it("summarizeArgs redacts secret-like keys", () => {
			const summary = observer.summarizeArgs({
				apiKey: "secret",
				filePath: "/x/y.ts",
			});
			expect(summary).toContain("apiKey: <redacted>");
			expect(summary).toContain("filePath: /x/y.ts");
		});
		it("summarizeArgs extracts paths and commands", () => {
			const summary = observer.summarizeArgs({
				filePath: "/foo/bar.ts",
				command: "npm test",
			});
			expect(summary).toContain("filePath: /foo/bar.ts");
			expect(summary).toContain("command: npm test");
		});
		it("summarizeArgs truncates long non-interesting values", () => {
			const long = "x".repeat(500);
			const summary = observer.summarizeArgs({ blob: long });
			expect(summary).toContain("...");
			expect(summary.length).toBeLessThan(600);
		});
	});

	describe("error_type", () => {
		it('detects typecheck from "error TS..."', () => {
			expect(
				observer.inferErrorType("error TS2304: Cannot find name", ""),
			).toBe("typecheck");
		});
		it("detects typecheck from tsc", () => {
			expect(observer.inferErrorType("running tsc failed", "")).toBe(
				"typecheck",
			);
		});
		it("detects lint from biome", () => {
			expect(observer.inferErrorType("biome found 3 errors", "")).toBe("lint");
		});
		it("detects test from FAIL", () => {
			expect(observer.inferErrorType("FAIL src/test.ts", "")).toBe("test");
		});
		it("detects test from vitest", () => {
			expect(observer.inferErrorType("vitest exited with code 1", "")).toBe(
				"test",
			);
		});
		it("detects runtime from TypeError", () => {
			expect(observer.inferErrorType("TypeError: x is undefined", "")).toBe(
				"runtime",
			);
		});
		it("detects runtime from ReferenceError", () => {
			expect(
				observer.inferErrorType("ReferenceError: foo is not defined", ""),
			).toBe("runtime");
		});
		it("detects timeout when stderr empty and exitCode -1", () => {
			expect(observer.inferErrorType("", "", -1)).toBe("timeout");
		});
		it("detects unknown for random output", () => {
			expect(observer.inferErrorType("random output", "")).toBe("unknown");
		});
		it("typecheck takes priority (first match wins)", () => {
			expect(observer.inferErrorType("error TS2304 also FAIL", "")).toBe(
				"typecheck",
			);
		});
	});
});

describe("ToolCallObserver — integration (before/after hooks)", () => {
	it("registers a row in tool_calls after onAfter with success=true", async () => {
		const input = {
			tool: "bash",
			sessionId: "s1",
			args: { command: "npm test" },
		};
		observer.onBefore(input, {});
		await new Promise((r) => setTimeout(r, 10));
		observer.onAfter(input, { success: true, stdout: "ok", exitCode: 0 });
		const row = rowForSession("s1");
		expect(row.tool).toBe("bash");
		expect(row.success).toBe(1);
		expect(row.duration_ms).toBeGreaterThanOrEqual(0);
		expect(row.error_type).toBeNull();
		expect(row.args_summary).toContain("command: npm test");
	});

	it("registers duration_ms > 0 when there is delay", async () => {
		const input = {
			tool: "read",
			sessionId: "s2",
			args: { filePath: "/a/b.ts" },
		};
		observer.onBefore(input, {});
		await new Promise((r) => setTimeout(r, 15));
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = rowForSession("s2");
		expect(row.duration_ms).toBeGreaterThanOrEqual(10);
	});

	it("records success=0 and error_type=typecheck on failed typecheck", () => {
		const input = { tool: "bash", sessionId: "s3" };
		observer.onBefore(input, {});
		observer.onAfter(input, {
			success: false,
			stderr: "error TS2304: Cannot find name 'foo'",
			exitCode: 1,
		});
		const row = rowForSession("s3");
		expect(row.success).toBe(0);
		expect(row.error_type).toBe("typecheck");
	});

	it("records agent from input when provided", () => {
		const input = { tool: "bash", sessionId: "s4", agent: "build" };
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = rowForSession("s4");
		expect(row.agent).toBe("build");
	});

	it("redacts secrets from args_summary and metadata", () => {
		const input = {
			tool: "bash",
			sessionId: "s5",
			args: { command: "deploy API_KEY=supersecret" },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = rowForSession("s5");
		expect(row.args_summary).not.toContain("supersecret");
		expect(row.args_summary).toContain("<redacted>");
		const metadata = JSON.parse(row.metadata) as { command: string };
		expect(metadata.command).not.toContain("supersecret");
		expect(metadata.command).toContain("<redacted>");
	});

	it("redacts secret-like arg keys in full metadata", () => {
		const input = {
			tool: "bash",
			sessionId: "s6",
			args: { apiKey: "abc123", filePath: "/x.ts" },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = rowForSession("s6");
		const metadata = JSON.parse(row.metadata) as {
			apiKey: string;
			filePath: string;
		};
		expect(metadata.apiKey).toBe("<redacted>");
		expect(metadata.filePath).toBe("/x.ts");
	});

	it("uses 'unknown' as sessionId when none provided", () => {
		const input = { tool: "bash" };
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = rowForSession("unknown");
		expect(row).toBeDefined();
	});

	it("redacts nested file paths and secrets inside object args (F#26)", () => {
		const input = {
			tool: "bash",
			sessionId: "s7",
			args: {
				command: "cat /home/user/secret.ts",
				env: { API_KEY: "supersecret", NODE_ENV: "prod" },
			},
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = rowForSession("s7");
		const metadata = JSON.parse(row.metadata) as {
			command: string;
			env: { API_KEY: string; NODE_ENV: string };
		};
		expect(metadata.command).not.toContain("/home/user/secret.ts");
		expect(metadata.command).toContain("<path>");
		expect(metadata.env.API_KEY).toBe("<redacted>");
		expect(metadata.env.NODE_ENV).toBe("prod");
		expect(row.args_summary).not.toContain("/home/user/secret.ts");
	});

	it("redacts paths inside array args (F#26)", () => {
		const input = {
			tool: "edit",
			sessionId: "s8",
			args: { files: ["/var/log/app.log", "/tmp/build/out.ts"] },
		};
		observer.onBefore(input, {});
		observer.onAfter(input, { success: true, exitCode: 0 });
		const row = rowForSession("s8");
		const metadata = JSON.parse(row.metadata) as { files: string[] };
		expect(metadata.files[0]).toBe("<path>");
		expect(metadata.files[1]).toBe("<path>");
	});
});
