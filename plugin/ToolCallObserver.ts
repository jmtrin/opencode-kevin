import type { Store } from "./Store.js";
import { redactPaths } from "./redact.js";
import { uuidv7 } from "./uuid.js";

export interface ToolExecuteInput {
	tool: string;
	args?: Record<string, unknown>;
	agent?: string;
	sessionId?: string;
	callID?: string;
}

export interface ToolExecuteOutput {
	success?: boolean;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

const SECRET_PATTERNS: RegExp[] = [
	/(API_KEY|SECRET|PASSWORD|TOKEN)\s*[=:]\s*\S+/gi,
	/\bBearer\s+\S+/gi,
	/\btoken\s+\S+/gi,
];

const SECRET_VALUE_PATTERN = /\s*=\s*\S+(.*)$/;

export class ToolCallObserver {
	private startTs = new Map<string, number>();

	constructor(private store: Store) {}

	onBefore(input: ToolExecuteInput, _output: ToolExecuteOutput): void {
		const key = this.key(input);
		this.startTs.set(key, Date.now());
	}

	onAfter(input: ToolExecuteInput, output: ToolExecuteOutput): void {
		const key = this.key(input);
		const start = this.startTs.get(key) ?? Date.now();
		this.startTs.delete(key);
		const durationMs = Math.max(0, Date.now() - start);
		const sessionId = input.sessionId ?? "unknown";
		const argsSummary = this.summarizeArgs(input.args ?? {});
		const success = output.success === true ? 1 : 0;
		const agent = input.agent ?? null;
		const errorType =
			output.success === false
				? this.inferErrorType(
						output.stderr ?? "",
						output.stdout ?? "",
						output.exitCode,
					)
				: null;
		const metadata = JSON.stringify(this.redactArgs(input.args ?? {}));

		this.store
			.prepare(
				`INSERT INTO tool_calls
				 (id, session_id, ts, tool, args_summary, success, duration_ms, agent, error_type, metadata)
				 VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				uuidv7(),
				sessionId,
				input.tool,
				argsSummary,
				success,
				durationMs,
				agent,
				errorType,
				metadata,
			);
	}

	redactSecrets(text: string): string {
		let out = text;
		for (const pat of SECRET_PATTERNS) {
			out = out.replace(pat, (match) => {
				const eq = match.match(SECRET_VALUE_PATTERN);
				if (eq) {
					const label = match.split(/[=:]/)[0].trim();
					return `${label}=<redacted>`;
				}
				const parts = match.split(/\s+/);
				return `${parts[0]} <redacted>`;
			});
		}
		return out;
	}

	summarizeArgs(args: Record<string, unknown>): string {
		const interestingKeys = [
			"filePath",
			"path",
			"cwd",
			"command",
			"cmd",
			"file",
			"directory",
		];
		const parts: string[] = [];
		for (const [k, v] of Object.entries(args)) {
			if (interestingKeys.includes(k)) {
				parts.push(`${k}: ${this.redactValue(v)}`);
			} else if (this.looksSecret(k)) {
				parts.push(`${k}: <redacted>`);
			} else {
				parts.push(`${k}: ${this.redactValue(v, 200)}`);
			}
		}
		let summary = parts.join(", ");
		if (summary.length > 500) summary = `${summary.slice(0, 500)}...`;
		return summary;
	}

	inferErrorType(stderr: string, stdout: string, exitCode?: number): string {
		const combined = `${stderr}\n${stdout}`.toLowerCase();
		if (
			exitCode === 124 ||
			/timed out|timeout|etimedout|\bkilled\b|sigterm|sigkill/.test(combined)
		) {
			return "timeout";
		}
		if (/error ts|tsc|\btypescript\b/.test(combined)) return "typecheck";
		if (/\b(lint|biome|eslint)\b/.test(combined)) return "lint";
		if (/\b(fail|vitest|jest|test failed)\b/.test(combined)) return "test";
		if (/error:|typeerror|referenceerror|syntaxerror/.test(combined))
			return "runtime";
		if (
			(exitCode === undefined || exitCode === -1) &&
			stderr.trim() === "" &&
			stdout.trim() === ""
		) {
			return "timeout";
		}
		return "unknown";
	}

	private key(input: ToolExecuteInput): string {
		if (input.callID) return `callID::${input.callID}`;
		const argsKey = JSON.stringify(input.args ?? {});
		return `${input.sessionId ?? "unknown"}::${input.tool}::${argsKey}`;
	}

	private looksSecret(key: string): boolean {
		const k = key.toLowerCase();
		return /(key|secret|password|token|bearer)/.test(k);
	}

	private redactArgs(args: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(args)) {
			if (this.looksSecret(k)) {
				out[k] = "<redacted>";
			} else {
				out[k] = this.redactValue(v);
			}
		}
		return out;
	}

	private redactValue(v: unknown, truncateAt?: number): unknown {
		if (typeof v === "string") {
			let s = redactPaths(v);
			s = this.redactSecrets(s);
			if (truncateAt !== undefined && s.length > truncateAt) {
				s = `${s.slice(0, truncateAt)}...`;
			}
			return s;
		}
		if (Array.isArray(v)) {
			return v.map((item) => this.redactValue(item));
		}
		if (v && typeof v === "object") {
			const obj: Record<string, unknown> = {};
			for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
				if (this.looksSecret(k)) {
					obj[k] = "<redacted>";
				} else {
					obj[k] = this.redactValue(val);
				}
			}
			return obj;
		}
		return v;
	}
}
