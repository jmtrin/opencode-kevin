/**
 * v0.5.0 (K5-018 / plan §5.8) — replay transcript format.
 *
 * A hermetic, deterministic way to run a recorded session through the
 * plugin's components and read the outcome distribution. `at` is an
 * ISO-8601 string and is the ONLY source of time during replay:
 * `Date.now()` must not be called anywhere in the replay path.
 *
 * v0.7.0 — hand-rolled validation: the zod dependency was removed
 * (docs/Kevin_v0.9.0_Plan.md D9-05). This module has no zod import.
 */

const EVENT_KINDS = [
	"session.created",
	"chat.message",
	"tool.before",
	"tool.after",
	"system.transform",
	"compacting",
	"session.idle",
] as const;

export type ReplayEvent =
	| { kind: "session.created"; at: string; sessionId: string }
	| { kind: "chat.message"; at: string; sessionId: string; text: string }
	| {
			kind: "tool.before";
			at: string;
			sessionId: string;
			callId: string;
			tool: string;
			args: Record<string, unknown>;
	  }
	| {
			kind: "tool.after";
			at: string;
			sessionId: string;
			callId: string;
			success: boolean;
			stdout?: string;
			stderr?: string;
			exitCode?: number;
	  }
	| { kind: "system.transform"; at: string; sessionId: string }
	| { kind: "compacting"; at: string; sessionId: string }
	| { kind: "session.idle"; at: string; sessionId: string };

export interface ReplayTranscript {
	readonly version: 1;
	readonly name: string;
	readonly events: readonly ReplayEvent[];
}

type RecordLike = Record<string, unknown>;

const ISO_DATETIME_RE =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isObject(value: unknown): value is RecordLike {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDatetime(value: unknown): value is string {
	return (
		typeof value === "string" &&
		ISO_DATETIME_RE.test(value) &&
		!Number.isNaN(Date.parse(value))
	);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

function parseEvent(value: unknown): ReplayEvent {
	if (!isObject(value)) {
		throw new Error("replay event must be an object");
	}
	const kind = value.kind;
	if (
		typeof kind !== "string" ||
		!(EVENT_KINDS as readonly string[]).includes(kind)
	) {
		throw new Error(`unknown replay event kind: ${String(kind)}`);
	}
	const at = value.at;
	if (!isIsoDatetime(at)) {
		throw new Error("replay event `at` must be an ISO-8601 datetime string");
	}
	const sessionId = value.sessionId;
	if (!isNonEmptyString(sessionId)) {
		throw new Error("replay event `sessionId` must be a non-empty string");
	}

	switch (kind) {
		case "session.created":
		case "system.transform":
		case "compacting":
		case "session.idle":
			return { kind, at, sessionId };
		case "chat.message": {
			const text = value.text;
			if (!isNonEmptyString(text)) {
				throw new Error("chat.message `text` must be a non-empty string");
			}
			return { kind, at, sessionId, text };
		}
		case "tool.before": {
			const callId = value.callId;
			if (!isNonEmptyString(callId)) {
				throw new Error("tool.before `callId` must be a non-empty string");
			}
			const tool = value.tool;
			if (!isNonEmptyString(tool)) {
				throw new Error("tool.before `tool` must be a non-empty string");
			}
			if (!isObject(value.args)) {
				throw new Error("tool.before `args` must be an object");
			}
			return { kind, at, sessionId, callId, tool, args: value.args };
		}
		case "tool.after": {
			const callId = value.callId;
			if (!isNonEmptyString(callId)) {
				throw new Error("tool.after `callId` must be a non-empty string");
			}
			if (typeof value.success !== "boolean") {
				throw new Error("tool.after `success` must be a boolean");
			}
			const event: ReplayEvent = {
				kind,
				at,
				sessionId,
				callId,
				success: value.success,
			};
			if (value.stdout !== undefined) {
				if (!isNonEmptyString(value.stdout)) {
					throw new Error("tool.after `stdout` must be a non-empty string");
				}
				event.stdout = value.stdout;
			}
			if (value.stderr !== undefined) {
				if (!isNonEmptyString(value.stderr)) {
					throw new Error("tool.after `stderr` must be a non-empty string");
				}
				event.stderr = value.stderr;
			}
			if (value.exitCode !== undefined) {
				if (!isInteger(value.exitCode)) {
					throw new Error("tool.after `exitCode` must be an integer");
				}
				event.exitCode = value.exitCode;
			}
			return event;
		}
	}
	throw new Error(`unhandled replay event kind: ${String(kind)}`);
}

/** Validates an unknown payload (e.g. a parsed JSON file) as a transcript. */
export function parseTranscript(json: unknown): ReplayTranscript {
	if (!isObject(json)) {
		throw new Error("replay transcript must be an object");
	}
	if (json.version !== 1) {
		throw new Error("replay transcript `version` must be 1");
	}
	const name = json.name;
	if (!isNonEmptyString(name)) {
		throw new Error("replay transcript `name` must be a non-empty string");
	}
	if (!Array.isArray(json.events) || json.events.length === 0) {
		throw new Error("replay transcript `events` must be a non-empty array");
	}
	return {
		version: 1,
		name,
		events: json.events.map(parseEvent),
	};
}

interface SchemaLike<T> {
	parse(value: unknown): T;
	safeParse(
		value: unknown,
	): { success: true; data: T } | { success: false; error: Error };
}

function toSchema<T>(parse: (value: unknown) => T): SchemaLike<T> {
	return {
		parse,
		safeParse(value: unknown) {
			try {
				return { success: true as const, data: parse(value) };
			} catch (error) {
				return {
					success: false as const,
					error: error instanceof Error ? error : new Error(String(error)),
				};
			}
		},
	};
}

export const replayEventSchema = toSchema<ReplayEvent>(parseEvent);

export const replayTranscriptSchema =
	toSchema<ReplayTranscript>(parseTranscript);
