/**
 * K6-010 — v0.6.0 pull — deterministic error-knowledge classifier (plan §5.3).
 *
 * Pure module: no DB, no clock, no filesystem, no RNG. Fully unit-testable in
 * isolation, and therefore fully unit-tested.
 */

export type Inferability = "inferable" | "non_inferable" | "unknown";

/**
 * The `Reflector` dispatch surface of §3.4, restated as data: error codes whose
 * payload IS the knowledge — no project-specific interpretation required.
 */
export const SELF_DESCRIBING_CODES: ReadonlySet<string> = new Set([
	"TS2304",
	"TS2307",
	"TS2322",
	"TS2339",
	"TS2305",
	"TS2552",
	"TS2740",
	"TS6133",
	"TS18047",
	"E0433",
	"E0432",
	"command_not_found",
]);

/**
 * Rule 4 detector — deliberately conservative. Errs toward `non_inferable`,
 * because a false `inferable` silently withholds real knowledge from curation
 * forever, while a false `non_inferable` costs one line a human rejects.
 */
const NPM_RUN_RE = /\b(?:npm|pnpm|yarn|bun)(?:\s+(?:run|exec))?\s+[\w@:/-]+/;
const RELATIVE_PATH_RE = /\.{1,2}\/[\w./@-]+/;
const FLAG_RE = /(?:^|\s)--[\w-]+/;
const FILE_EXT_RE = /\b[\w./@-]+\.[a-zA-Z][a-zA-Z0-9]{0,7}\b/;

function namesProjectSpecific(content: string): boolean {
	return (
		NPM_RUN_RE.test(content) ||
		RELATIVE_PATH_RE.test(content) ||
		FLAG_RE.test(content) ||
		FILE_EXT_RE.test(content)
	);
}

function dispatchCode(metadata: unknown): string | null {
	if (metadata === null || typeof metadata !== "object") return null;
	const dispatch = (metadata as { dispatch?: unknown }).dispatch;
	if (dispatch === null || typeof dispatch !== "object") return null;
	const code = (dispatch as { code?: unknown }).code;
	return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * Rules from plan §5.3, evaluated in order — the ordering is the specification:
 *
 *  1. `type` ∈ decision / rule / solution → `non_inferable`
 *  2. `type` = pattern → `non_inferable`
 *  3. `type` = error and `metadata.dispatch.code` ∈ SELF_DESCRIBING_CODES → `inferable`
 *  4. `type` = error and content names a project-specific path, script or flag → `non_inferable`
 *  5. otherwise → `unknown`
 *
 * Rule 4 beats rule 3: a TS2304 is inferable, but "TS2304 on
 * `./scripts/gen-routes.ts` because the generator must run before tsc" is not —
 * the project-specific script name is the payload, not the code. Rule 3's
 * condition (code membership) is evaluated first for the bare case; rule 4
 * catches what rule 3 does not.
 */
export function classify(memory: {
	type: string;
	content: string;
	metadata?: unknown;
}): Inferability {
	// Rule 1 — authored knowledge is never re-derived.
	if (
		memory.type === "decision" ||
		memory.type === "rule" ||
		memory.type === "solution"
	) {
		return "non_inferable";
	}
	// Rule 2 — a mined sequence is project-specific by construction.
	if (memory.type === "pattern") {
		return "non_inferable";
	}
	if (memory.type === "error") {
		const code = dispatchCode(memory.metadata);
		// Rule 4 — content naming a project-specific path, script or flag.
		if (namesProjectSpecific(memory.content)) {
			return "non_inferable";
		}
		// Rule 3 — a bare self-describing code is inferable.
		if (code !== null && SELF_DESCRIBING_CODES.has(code)) {
			return "inferable";
		}
	}
	// Rule 5.
	return "unknown";
}
