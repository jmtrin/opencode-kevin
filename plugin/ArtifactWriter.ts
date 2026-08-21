import { createHash } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import type { Store } from "./Store.js";
import { unifiedDiff } from "./diff.js";
import {
	escapeForFence,
	escapeForMarkerBlock,
	escapeForOkfLine,
} from "./escape.js";
import type { Metrics } from "./metrics.js";
import { uuidv7 } from "./uuid.js";

// v0.6.0 (K6-005 / plan §5.1, D6-02) — the frozen marker contract. The exact
// byte sequences are load-bearing: README, v1.0.0 plan C-01 and the round-trip
// test all depend on them.
export const MARKER_BEGIN =
	"<!-- kevin:begin — curated by opencode-kevin, safe to edit -->";
export const MARKER_END = "<!-- kevin:end -->";

export type WriteOutcome = "written" | "noop" | "refused";

/**
 * v0.8.0 (K8-019 / D8-08) — the two write modes. `markers` is the
 * v0.6.0 behaviour, byte for byte: a splice between the two marker
 * comments, used for `AGENTS.md`, a file humans edit. `whole` replaces
 * the entire file and is used only for Kevin-owned paths such as
 * `.kevin/knowledge.okf` — a file humans do not hand-edit.
 */
export type WriteMode = "markers" | "whole";

export interface WriteRequest {
	readonly path: string;
	readonly mode: WriteMode;
	/** marker block body ("markers"), or whole-file content ("whole"). */
	readonly content: string;
	/**
	 * Caller-side refusal reason (K8-020 / D6-03): when present, the plan
	 * is refused — nothing is written, and the refusal is audited with
	 * both hashes. The refusal conditions belong to the caller; the
	 * writer only records them.
	 */
	readonly refusal?: string;
}

export interface WritePlan {
	readonly path: string;
	readonly before: string;
	readonly after: string;
	readonly diff: string;
	readonly outcome: WriteOutcome;
	readonly reason?: string;
	readonly hashBefore: string;
	readonly hashAfter: string;
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Rule 5 (K6-008 / plan §5.1, D6-02) — the line-ending style comes from the
 * FIRST line ending in the existing file: CRLF if it is CRLF, otherwise LF.
 * A CRLF file whose last line lacks a terminator, and a mixed-ending file,
 * are both resolved by the same first-ending rule, deterministically.
 */
function detectEol(text: string): "\r\n" | "\n" {
	const nl = text.indexOf("\n");
	if (nl === -1) return "\n";
	return nl > 0 && text[nl - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * Rule 5 (K6-008) — normalize the generated body into the file's line-ending
 * style so a CRLF file stays CRLF everywhere, including inside the block.
 */
function normalizeEol(body: string, eol: "\r\n" | "\n"): string {
	return body.replace(/\r\n/g, "\n").replace(/\n/g, eol);
}

/**
 * Rule 9, layer (a) — superseded in v1.0.0 by `escapeForMarkerBlock`
 * in `plugin/escape.ts` (K10-027), which carries the same idempotent
 * entity discipline.
 */

/**
 * v1.0.0 (K10-027 / plan §5.7) — the boundary functions now live in
 * `plugin/escape.ts`; this composer applies them in fence-then-marker
 * order. Layer (b) — strip any line containing `kevin:begin` or
 * `kevin:end`, in any casing — is a filter rather than an escape and
 * stays here. Without layer (b), a memory containing a literal
 * `<!-- kevin:end -->` line would close the marker comment early and
 * let subsequent content escape the curated region on the next
 * regeneration — a marker-injection variant of the v0.1.5
 * prompt-injection defect (plan §3.5). The trailing `-->` strip is kept
 * as defence in depth although `escapeForMarkerBlock` already escapes
 * every `>` that could form one.
 */
export function sanitizeArtifactBody(body: string): string {
	const escaped = escapeForMarkerBlock(escapeForFence(body));
	const kept = escaped
		.split("\n")
		.filter((line) => !/kevin:begin|kevin:end/i.test(line))
		.join("\n");
	return kept.replace(/-->/g, "");
}

/**
 * v1.0.0 (K10-027 / plan §5.7, rule 2) — whole-file writes escape by
 * container. Only `.okf` files are line-oriented JSON: each line gets
 * `escapeForOkfLine`, which is the identity on a well-formed OKF line
 * (canonical JSON never contains raw control characters) and therefore
 * preserves the re-render `noop`. Kevin-owned markdown paths keep their
 * bytes — fences there are legitimate content.
 */
export function escapeForContainer(path: string, content: string): string {
	if (!path.endsWith(".okf")) return content;
	return content
		.split("\n")
		.map((line) => {
			// A CRLF file (healHeader preserves the original EOL) leaves a
			// trailing \r on each line after the split — it is line-ending
			// bytes, not statement content, so it must survive untouched.
			if (line.endsWith("\r")) {
				return `${escapeForOkfLine(line.slice(0, -1))}\r`;
			}
			return escapeForOkfLine(line);
		})
		.join("\n");
}

/**
 * v0.6.0 (K6-005 / plan §5.1) — the single write path to disk (D6-01).
 *
 * `plan()` is pure: it reads the target file, locates the marker pair, splices
 * the body between the markers and returns a {@link WritePlan}. It performs no
 * writes — rule 1. `apply()` is implemented by K6-007; until then it is a stub
 * that throws, so no caller can accidentally write before the audit trail
 * exists.
 *
 * `projectId` is a constructor argument rather than a per-call argument so that
 * every audit row is attributed without the call site having to remember.
 */
export class ArtifactWriter {
	private readonly store: Store;
	private readonly projectId: string;
	private readonly metrics: Metrics | null;

	constructor(store: Store, projectId: string, metrics?: Metrics | null) {
		this.store = store;
		this.projectId = projectId;
		this.metrics = metrics ?? null;
	}

	// v0.6.0 (K6-005 / plan §5.1, D6-02) — the two-argument form is the
	// markers-mode convenience kept so every v0.6.0 call site and test
	// stays byte-for-byte unmodified (K8-019 acceptance). The
	// WriteRequest form carries the mode explicitly.
	plan(path: string, body: string): WritePlan;
	plan(request: WriteRequest): WritePlan;
	plan(pathOrRequest: string | WriteRequest, body?: string): WritePlan {
		const request: WriteRequest =
			typeof pathOrRequest === "string"
				? { path: pathOrRequest, mode: "markers", content: body ?? "" }
				: pathOrRequest;
		const { path, mode, content } = request;
		let before: string;
		try {
			// Read as Buffer, not as utf8 text: readFileSync's text decoding
			// strips a leading BOM, which would silently drop it on the next
			// write. Buffer.toString keeps \uFEFF as a character of `before`.
			before = readFileSync(path).toString("utf8");
		} catch (err) {
			if (err instanceof Error && "code" in err && err.code === "ENOENT") {
				before = "";
			} else {
				throw err;
			}
		}

		if (mode === "whole") {
			// K8-019 (D8-08) — the whole-file path. The file is Kevin-owned,
			// so there are no markers, no sanitization and no EOL
			// normalization: the rendered bytes are written as-is, which is
			// what makes a re-render of the same content a `noop`. A
			// caller-side refusal leaves the file untouched and is audited
			// like any other refusal: after = before, both hashes recorded.
			const refusal = request.refusal;
			const refused = refusal !== undefined;
			// K10-027 — the container boundary: OKF lines are escaped at the
			// single write path, never by callers.
			const after = refused ? before : escapeForContainer(path, content);
			return {
				path,
				before,
				after,
				diff: unifiedDiff(path, before, after),
				outcome: refused ? "refused" : after === before ? "noop" : "written",
				...(refusal !== undefined ? { reason: refusal } : {}),
				hashBefore: sha256(before),
				hashAfter: sha256(after),
			};
		}

		const eol = detectEol(before);
		// Rule 9 — sanitation happens in plan(), before hashing, so the hashes
		// describe what was actually written.
		const bodyEol = normalizeEol(sanitizeArtifactBody(content), eol);
		const firstBegin = before.indexOf(MARKER_BEGIN);
		const firstEnd = before.indexOf(MARKER_END);
		let after: string;
		let outcome: WriteOutcome = "written";
		let reason: string | undefined;

		if (firstBegin === -1 && firstEnd === -1) {
			// Rule 2 — create: the block is appended at the end of the content,
			// preceded by a blank line. For an empty file (missing file treated
			// as "") the result is exactly: blank line, MARKER_BEGIN, body,
			// MARKER_END, trailing newline.
			const separator =
				before === "" ? eol : before.endsWith(eol) ? eol : eol + eol;
			after =
				before +
				separator +
				MARKER_BEGIN +
				eol +
				bodyEol +
				eol +
				MARKER_END +
				eol;
		} else if (firstBegin === -1 || firstEnd === -1) {
			// Rule 3 — exactly one marker present.
			after = before;
			outcome = "refused";
			reason =
				firstBegin === -1
					? "kevin:end marker present without kevin:begin"
					: "kevin:begin marker present without kevin:end";
		} else if (firstEnd < firstBegin) {
			// Rule 3 — MARKER_END precedes MARKER_BEGIN.
			after = before;
			outcome = "refused";
			reason = "kevin:end appears before kevin:begin";
		} else if (
			before.indexOf(MARKER_BEGIN, firstBegin + MARKER_BEGIN.length) !== -1 ||
			before.indexOf(MARKER_END, firstEnd + MARKER_END.length) !== -1
		) {
			// Rule 3 — more than one pair (any additional marker occurrence).
			after = before;
			outcome = "refused";
			reason = "more than one marker pair present";
		} else {
			// Rule 4 — bytes outside the marker pair are byte-identical. The
			// block between the markers (begin marker, old block, end marker)
			// is replaced by the regenerated block.
			const blockEnd = firstEnd + MARKER_END.length;
			after =
				before.slice(0, firstBegin) +
				MARKER_BEGIN +
				eol +
				bodyEol +
				eol +
				MARKER_END +
				before.slice(blockEnd);
			// Rule 6 — unchanged content is a noop, never a write.
			outcome = after === before ? "noop" : "written";
		}

		return {
			path,
			before,
			after,
			// v0.6.0 (K6-006 / plan §5.2, D6-05) — approval prompts show bytes,
			// never prose. Identical inputs yield "".
			diff: unifiedDiff(path, before, after),
			outcome,
			...(reason !== undefined ? { reason } : {}),
			hashBefore: sha256(before),
			hashAfter: sha256(after),
		};
	}

	/**
	 * K8-019 (D8-08) — the single write funnel: every file Kevin writes
	 * goes through this method, which is the ONLY call site of `apply()`
	 * in the plugin (asserted by tests/unit/single_write_path.test.ts).
	 */
	write(request: WriteRequest, proposalId?: string): WriteOutcome {
		return this.apply(this.plan(request), proposalId);
	}

	// v0.6.0 (K6-007 / plan §5.1, rules 7–8) — atomic write + audit row.
	apply(plan: WritePlan, proposalId?: string): WriteOutcome {
		// Rule 8 — refusals and noops still leave an audit trail; a refusal
		// that leaves no trace is indistinguishable from a write that never
		// happened. Rule 6 — a noop creates no temp file and writes nothing.
		if (plan.outcome === "noop" || plan.outcome === "refused") {
			if (plan.outcome === "noop") {
				this.metrics?.incr("artifact_writes_noop", 1);
			}
			this.audit(plan, proposalId);
			return plan.outcome;
		}

		// Rule 7 — write to `<path>.kevin.tmp` in the same directory (same
		// filesystem, so rename is atomic), fsync, close, then rename over the
		// target. Never write the target path directly, never truncate-then-write.
		const tmpPath = `${plan.path}.kevin.tmp`;
		let fd: number | undefined;
		try {
			fd = openSync(tmpPath, "w");
			writeSync(fd, plan.after, null, "utf8");
			fsyncSync(fd);
			closeSync(fd);
			fd = undefined;
			this.renameTemp(tmpPath, plan.path);
		} catch (err) {
			// Never leave .kevin.tmp litter next to the user's file.
			if (fd !== undefined) {
				try {
					closeSync(fd);
				} catch {
					// already closed or unusable; unlink below is the cleanup
				}
			}
			try {
				unlinkSync(tmpPath);
			} catch {
				// nothing to clean up
			}
			throw err;
		}
		this.metrics?.incr("artifact_writes_total", 1);
		this.audit(plan, proposalId);
		return "written";
	}

	// Fault-injection seam for the atomicity test: the rename is the point
	// where a failure must leave the target untouched and the temp file gone.
	private renameTemp(tmpPath: string, target: string): void {
		renameSync(tmpPath, target);
	}

	private audit(plan: WritePlan, proposalId: string | undefined): void {
		this.store
			.prepare(
				`INSERT INTO artifact_writes
				 (id, proposal_id, project_id, path, bytes_before, bytes_after,
				  hash_before, hash_after, outcome, reason)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				uuidv7(),
				proposalId ?? null,
				this.projectId,
				plan.path,
				Buffer.byteLength(plan.before, "utf8"),
				Buffer.byteLength(plan.after, "utf8"),
				plan.hashBefore,
				plan.hashAfter,
				plan.outcome,
				plan.reason ?? null,
			);
	}
}
