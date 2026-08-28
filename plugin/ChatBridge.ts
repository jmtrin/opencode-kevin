// v1.2.0 (K12-018 / plan §4.4 R3, D12-09) — chat-command bridge (universal actions).
// Hot path: ONE regex test on non-match, allocation-free.

import {
	type PendingProposal,
	proposalToken,
	verifyFresh,
} from "./TuiActions.js";

export type BridgeDeps = {
	readonly getPending: () => readonly PendingProposal[];
	readonly approve: (proposalId: string) => unknown;
	readonly reject: (proposalId: string, note?: string) => unknown;
	readonly acknowledge: (conflictId: string) => unknown;
	readonly metrics?: {
		incr: (key: "tui_actions_invoked", by?: number) => void;
	} | null;
};

// Exact regex for approve/reject (require 16-hex token, optional note capture).
// Ack variant is token-free (acknowledge is non-destructive, matches mailbox).
const APPROVE_REJECT_RE =
	/^\/kevin-(approve|reject)\s+(\S+)\s+([0-9a-f]{16})(?:\s+([\s\S]+))?$/;
const ACK_RE = /^\/kevin-ack\s+(\S+)\s*$/;
// Combined pattern for documentation / static analysis (covers both forms).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _DOC_RE =
	/^\/kevin-(approve|reject|ack)\s+(\S+)\s+([0-9a-f]{16})(?:\s+([\s\S]+))?$/;

export type ParsedBridgeCommand =
	| {
			readonly type: "approve";
			readonly proposalId: string;
			readonly token: string;
			readonly note?: string;
	  }
	| {
			readonly type: "reject";
			readonly proposalId: string;
			readonly token: string;
			readonly note?: string;
	  }
	| { readonly type: "ack"; readonly conflictId: string };

export function parseBridgeCommand(text: string): ParsedBridgeCommand | null {
	// Approve / reject — require token
	const m = APPROVE_REJECT_RE.exec(text);
	if (m) {
		const type = m[1] as "approve" | "reject";
		const proposalId = m[2];
		const token = m[3];
		const note = m[4] !== undefined ? m[4] : undefined;
		if (type === "approve")
			return {
				type: "approve",
				proposalId,
				token,
				...(note !== undefined ? { note } : {}),
			};
		return {
			type: "reject",
			proposalId,
			token,
			...(note !== undefined ? { note } : {}),
		};
	}
	const ack = ACK_RE.exec(text);
	if (ack) {
		return { type: "ack", conflictId: ack[1] };
	}
	return null;
}

// Backward alias for tests that import by plan name
export const KEVIN_COMMAND_RE = APPROVE_REJECT_RE;

export interface BridgeResult {
	readonly handled: boolean; // true = swallowed (valid), false = pass-through
	readonly status?: "applied" | "rejected" | "stale_skipped" | "error";
	readonly detail?: string;
}

/**
 * Execute a chat message through the bridge.
 * - Non-matching → {handled:false} (byte-identical pass-through)
 * - Matching but stale/invalid → {handled:false, status:"stale_skipped"} (pass-through + counter)
 * - Valid → executes via deps handlers, {handled:true}
 *
 * Valid commands are SWALLOWED — caller must not forward to model.
 * Invalid/stale commands pass through untouched (D12-09).
 */
export function handleBridgeCommand(
	text: string,
	deps: BridgeDeps,
): BridgeResult {
	const parsed = parseBridgeCommand(text);
	if (!parsed) return { handled: false };

	if (parsed.type === "ack") {
		// Ack is non-destructive, no token verification — matches mailbox acknowledge semantics.
		try {
			deps.acknowledge(parsed.conflictId);
			try {
				deps.metrics?.incr("tui_actions_invoked", 1);
			} catch {}
			return { handled: true, status: "applied" };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { handled: true, status: "error", detail: msg };
		}
	}

	// approve / reject — verify token against CURRENT pending state (same as mailbox)
	const pending = deps.getPending();
	const action = {
		type: parsed.type as "approve" | "reject",
		proposalId: parsed.proposalId,
		token: parsed.token,
		...(parsed.note !== undefined ? { note: parsed.note } : {}),
	} as const;
	const fresh = verifyFresh(action, pending);
	if (!fresh.ok) {
		// Invalid/stale → pass-through untouched (do NOT swallow). Caller should forward byte-identically.
		// Audit counter could be incremented here, but not as contract metric (blockedSnapshot-style internal).
		return { handled: false, status: "stale_skipped", detail: fresh.reason };
	}
	try {
		if (parsed.type === "approve") {
			deps.approve(parsed.proposalId);
			try {
				deps.metrics?.incr("tui_actions_invoked", 1);
			} catch {}
			return { handled: true, status: "applied" };
		}
		deps.reject(parsed.proposalId, parsed.note);
		try {
			deps.metrics?.incr("tui_actions_invoked", 1);
		} catch {}
		return { handled: true, status: "rejected" };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { handled: true, status: "error", detail: msg };
	}
}
