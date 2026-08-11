import { z } from "zod";

/**
 * v0.5.0 (K5-018 / plan §5.8) — replay transcript format.
 *
 * A hermetic, deterministic way to run a recorded session through the
 * plugin's components and read the outcome distribution. `at` is an
 * ISO-8601 string and is the ONLY source of time during replay:
 * `Date.now()` must not be called anywhere in the replay path.
 */

export const replayEventSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("session.created"),
		at: z.string().datetime(),
		sessionId: z.string().min(1),
	}),
	z.object({
		kind: z.literal("chat.message"),
		at: z.string().datetime(),
		sessionId: z.string().min(1),
		text: z.string().min(1),
	}),
	z.object({
		kind: z.literal("tool.before"),
		at: z.string().datetime(),
		sessionId: z.string().min(1),
		callId: z.string().min(1),
		tool: z.string().min(1),
		args: z.record(z.string(), z.unknown()),
	}),
	z.object({
		kind: z.literal("tool.after"),
		at: z.string().datetime(),
		sessionId: z.string().min(1),
		callId: z.string().min(1),
		success: z.boolean(),
		stdout: z.string().optional(),
		stderr: z.string().optional(),
		exitCode: z.number().int().optional(),
	}),
	z.object({
		kind: z.literal("system.transform"),
		at: z.string().datetime(),
		sessionId: z.string().min(1),
	}),
	z.object({
		kind: z.literal("compacting"),
		at: z.string().datetime(),
		sessionId: z.string().min(1),
	}),
	z.object({
		kind: z.literal("session.idle"),
		at: z.string().datetime(),
		sessionId: z.string().min(1),
	}),
]);

export type ReplayEvent = z.infer<typeof replayEventSchema>;

export const replayTranscriptSchema = z.object({
	version: z.literal(1),
	name: z.string().min(1),
	events: z.array(replayEventSchema).min(1),
});

export interface ReplayTranscript {
	readonly version: 1;
	readonly name: string;
	readonly events: readonly ReplayEvent[];
}

/** Validates an unknown payload (e.g. a parsed JSON file) as a transcript. */
export function parseTranscript(json: unknown): ReplayTranscript {
	return replayTranscriptSchema.parse(json) as ReplayTranscript;
}
