// v1.2.0 (K12-005 / plan §4.3) — mailbox tolerant parser (phase F1).
// v1.2.0 (K12-006 / plan §4.3, D12-04) — token scheme + stale detection
import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ActionResult, TuiAction } from "./tui-types.js";

export interface MailboxReadResult {
	readonly actions: readonly TuiAction[];
	readonly warnings: readonly string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidAction(raw: unknown): TuiAction | null {
	if (!isRecord(raw)) return null;
	const t = raw.type;
	if (t === "approve") {
		if (typeof raw.proposalId === "string" && typeof raw.token === "string") {
			return { type: "approve", proposalId: raw.proposalId, token: raw.token };
		}
		return null;
	}
	if (t === "reject") {
		if (typeof raw.proposalId === "string" && typeof raw.token === "string") {
			const note = typeof raw.note === "string" ? raw.note : undefined;
			return note !== undefined
				? { type: "reject", proposalId: raw.proposalId, token: raw.token, note }
				: { type: "reject", proposalId: raw.proposalId, token: raw.token };
		}
		return null;
	}
	if (t === "acknowledge") {
		if (typeof raw.conflictId === "string") {
			return { type: "acknowledge", conflictId: raw.conflictId };
		}
		return null;
	}
	return null;
}

/**
 * Read `join(root,"tui","actions.json")` tolerant.
 * - missing file → {actions:[], warnings:[]}
 * - malformed JSON → {actions:[], warnings:["malformed_json"]}
 * - non-object or missing/non-array actions → {actions:[], warnings:["invalid_shape"]}
 * - unknown type values are dropped with warning per entry
 * Never deletes the file here.
 */
export function readMailbox(root: string): MailboxReadResult {
	const path = join(root, "tui", "actions.json");
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (err) {
		const code = (err as { code?: string })?.code;
		if (code === "ENOENT") return { actions: [], warnings: [] };
		return { actions: [], warnings: ["read_error"] };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { actions: [], warnings: ["malformed_json"] };
	}
	if (!isRecord(parsed)) {
		return { actions: [], warnings: ["invalid_shape"] };
	}
	const maybeActions = (parsed as Record<string, unknown>).actions;
	if (!Array.isArray(maybeActions)) {
		return { actions: [], warnings: ["invalid_shape"] };
	}
	const actions: TuiAction[] = [];
	const warnings: string[] = [];
	for (const entry of maybeActions) {
		if (!isRecord(entry)) {
			warnings.push("dropped_invalid_entry");
			continue;
		}
		const type = (entry as Record<string, unknown>).type;
		if (type !== "approve" && type !== "reject" && type !== "acknowledge") {
			warnings.push(`dropped_unknown_type:${String(type)}`);
			continue;
		}
		const valid = isValidAction(entry);
		if (!valid) {
			warnings.push(`dropped_invalid_${String(type)}`);
			continue;
		}
		actions.push(valid);
	}
	return { actions, warnings };
}

// v1.2.0 (K12-006 / D12-04) — first 16 hex of SHA-256(proposalId + "\0" + proposedText)
export function proposalToken(
	proposalId: string,
	proposedText: string,
): string {
	return createHash("sha256")
		.update(`${proposalId}\0${proposedText}`, "utf8")
		.digest("hex")
		.slice(0, 16);
}

export interface PendingProposal {
	readonly id: string;
	readonly proposedText: string;
}

export function verifyFresh(
	action: TuiAction,
	currentPending: readonly PendingProposal[],
): { ok: true } | { ok: false; reason: string } {
	if (action.type === "acknowledge") return { ok: true };
	const pending = currentPending.find((p) => p.id === action.proposalId);
	if (!pending) {
		return { ok: false, reason: "content_changed_or_absent" };
	}
	const expected = proposalToken(pending.id, pending.proposedText);
	if (expected !== action.token) {
		return { ok: false, reason: "content_changed_or_absent" };
	}
	return { ok: true };
}

// v1.2.0 (K12-007 / plan §4.3, D12-05) — processActions executing existing handlers

export type ActionStatus = ActionResult["status"];

export interface ProcessDeps {
	readonly getPending: () => readonly PendingProposal[];
	readonly approve: (proposalId: string) => unknown;
	readonly reject: (proposalId: string, note?: string) => unknown;
	readonly acknowledge: (conflictId: string) => unknown;
	readonly metrics?: {
		incr: (key: "tui_actions_invoked", by?: number) => void;
	} | null;
}

export function processActions(
	actions: readonly TuiAction[],
	deps: ProcessDeps,
): ActionResult[] {
	const results: ActionResult[] = [];
	const pendingSnapshot = deps.getPending();
	for (const action of actions) {
		// Stale check for approve/reject
		if (action.type === "approve" || action.type === "reject") {
			const fresh = verifyFresh(action, pendingSnapshot);
			if (!fresh.ok) {
				results.push({ action, status: "stale_skipped", detail: fresh.reason });
				try {
					deps.metrics?.incr("tui_actions_invoked", 1);
				} catch {}
				continue;
			}
		}
		try {
			if (action.type === "approve") {
				deps.approve(action.proposalId);
				results.push({ action, status: "applied" });
			} else if (action.type === "reject") {
				deps.reject(action.proposalId, action.note);
				results.push({ action, status: "rejected" });
			} else if (action.type === "acknowledge") {
				deps.acknowledge(action.conflictId);
				results.push({ action, status: "applied" });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results.push({ action, status: "error", detail: msg });
		}
		try {
			deps.metrics?.incr("tui_actions_invoked", 1);
		} catch {}
	}
	return results;
}

export function writeResults(
	root: string,
	results: readonly ActionResult[],
): void {
	const dir = join(root, "tui");
	mkdirSync(dir, { recursive: true });
	const payload = JSON.stringify(
		{ generatedAt: new Date().toISOString(), results },
		null,
		2,
	);
	const target = join(dir, "results.json");
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, payload, "utf8");
	renameSync(tmp, target);
}

export function deleteMailbox(root: string): void {
	try {
		unlinkSync(join(root, "tui", "actions.json"));
	} catch {
		// missing is fine
	}
}

/**
 * Convenience: read → process → write results → delete queue.
 * Returns results (empty if no actions). Mirrors idle-chain usage.
 */
export function consumeMailbox(
	root: string,
	deps: ProcessDeps,
): ActionResult[] {
	const { actions } = readMailbox(root);
	if (actions.length === 0) return [];
	const results = processActions(actions, deps);
	writeResults(root, results);
	deleteMailbox(root);
	return results;
}
