// v1.2.0 (K12-008 skeleton + K12-009 panels / plan §4.4 R1, D12-02) — TUI module (target-exclusive, conditional on K12-016 GO).
// Allowed imports ONLY: @opencode-ai/plugin/tui, node:fs, node:path, node:os, import type from ./tui-types.js
// No console.log; user feedback via host toast API.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import type {
	ActionResult,
	ConflictView,
	HealthView,
	ProposalView,
	TuiAction,
} from "./tui-types.js";

export function tuiRoot(): string {
	return join(homedir(), ".opencode-kevin", "tui");
}

export function readJsonSafe(
	name: string,
): { data: unknown } | { error: "missing" | "corrupt" } {
	const path = join(tuiRoot(), name);
	try {
		const raw = readFileSync(path, "utf8");
		try {
			return { data: JSON.parse(raw) };
		} catch {
			return { error: "corrupt" };
		}
	} catch (err) {
		const code = (err as { code?: string })?.code;
		if (code === "ENOENT") return { error: "missing" };
		return { error: "corrupt" };
	}
}

// --- Pure helpers (K12-009) — unit-testable, no host dependency ---

export function truncateSummary(text: string, max = 80): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

export function formatProposalRow(p: ProposalView): string {
	const trunc = p.truncated ? " [truncated]" : "";
	const ids = p.memory_ids.length ? ` memories:${p.memory_ids.join(",")}` : "";
	return `${p.id} ${p.kind} ${p.target_path} ${p.created_at}${trunc}${ids}`;
}

export function formatConflictRow(c: ConflictView): string {
	return `${c.kind} ${c.id} A:${truncateSummary(c.a_summary)} B:${truncateSummary(c.b_summary)}`;
}

export function formatHealthVerdict(h: HealthView): string {
	return `${h.verdict} — ${h.reason} — ${h.contract_digest}`;
}

// Mailbox writer — atomic tmp+rename, append semantics (pure fs, no network)
function writeMailboxAction(action: TuiAction): void {
	const dir = tuiRoot();
	mkdirSync(dir, { recursive: true });
	const target = join(dir, "actions.json");
	let existing: { issuedAt: string; actions: TuiAction[] } | null = null;
	try {
		const raw = readFileSync(target, "utf8");
		const parsed = JSON.parse(raw) as { issuedAt?: string; actions?: unknown };
		if (parsed && Array.isArray(parsed.actions)) {
			existing = {
				issuedAt: String(parsed.issuedAt ?? new Date().toISOString()),
				actions: parsed.actions as TuiAction[],
			};
		}
	} catch {
		// missing/corrupt → start fresh
	}
	const next = {
		issuedAt: new Date().toISOString(),
		actions: existing ? [...existing.actions, action] : [action],
	};
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
	renameSync(tmp, target);
}

function emptyState(reason: string): unknown {
	return reason as unknown;
}

export const tui: TuiPlugin = async (api) => {
	// Helper to show toast via host
	const toast = (
		message: string,
		variant: "info" | "success" | "warning" | "error" = "info",
	) => {
		try {
			api.ui.toast({ message, variant });
		} catch {
			// best-effort
		}
	};

	api.route.register([
		{
			name: "kevin",
			render: () => {
				// Re-read on focus (caller invokes render on focus)
				const proposalsRes = readJsonSafe("proposals.json");
				const conflictsRes = readJsonSafe("conflicts.json");
				const healthRes = readJsonSafe("health.json");

				if (
					"error" in proposalsRes ||
					"error" in conflictsRes ||
					"error" in healthRes
				) {
					const reason =
						"error" in proposalsRes
							? `proposals.json: ${proposalsRes.error}`
							: "error" in conflictsRes
								? `conflicts.json: ${conflictsRes.error}`
								: `health.json: ${(healthRes as { error: string }).error}`;
					return emptyState(
						`no snapshots yet — open an opencode session with the plugin enabled (${reason})`,
					);
				}

				const proposals = proposalsRes.data as ProposalView[];
				const conflicts = conflictsRes.data as ConflictView[];
				const health = healthRes.data as HealthView;

				// Skeleton counts + tabular summaries (full JSX rendering is host-driven;
				// this string representation carries the same data for headless verification).
				// Interactive flows (Enter→diff, a→approve, r→reject, x→acknowledge) are exposed as keymap commands below
				// and via api.ui.Dialog* when a host renders the route with Solid JSX — the string fallback ensures degrade-to-empty discipline.
				const proposalLines =
					Array.isArray(proposals) && proposals.length
						? proposals
								.map(
									(p) =>
										`· ${formatProposalRow(p)}\n  diff: ${truncateSummary(p.diff, 120)}${p.truncated ? " [truncated]" : ""}`,
								)
								.join("\n")
						: "  (no pending proposals)";
				const conflictLines =
					Array.isArray(conflicts) && conflicts.length
						? conflicts.map((c) => `· ${formatConflictRow(c)}`).join("\n")
						: "  (no open conflicts)";
				const healthLine = health ? formatHealthVerdict(health) : "unknown";
				const hooksLine = health?.hooks?.length
					? health.hooks
							.map(
								(h) =>
									`  ${h.hook} ${h.state} ${h.fire_count}/${h.expected_count}`,
							)
							.join("\n")
					: "  (no hooks)";
				const perfLine = health?.perf?.length
					? health.perf
							.map(
								(p) =>
									`  ${p.scope} p95:${p.p95} budget:${p.budget_p95} ${p.within_budget ? "ok" : "OVER"}`,
							)
							.join("\n")
					: "  (no perf)";
				const countersLine = health?.counters
					? Object.entries(health.counters)
							.map(([k, v]) => `${k}=${v}`)
							.join(" ")
					: "(no counters)";

				const msg = [
					`Kevin — Proposals (${Array.isArray(proposals) ? proposals.length : 0})`,
					proposalLines,
					"",
					`Conflicts (${Array.isArray(conflicts) ? conflicts.length : 0})`,
					conflictLines,
					"",
					`Health — ${healthLine}`,
					"hooks:",
					hooksLine,
					"perf:",
					perfLine,
					`counters: ${countersLine}`,
					"",
					"Keys: Enter=diff · a=approve · r=reject · x=acknowledge (via command palette) · k=open",
				].join("\n");

				return emptyState(msg);
			},
		},
	]);

	// Keymap layer: `k` opens the kevin route; also expose approve/reject/acknowledge commands for palette.
	try {
		const km = api.keymap as unknown as {
			registerLayer?: (layer: {
				commands: Record<string, { title?: string; description?: string }>;
				bindings: Record<string, string>;
			}) => () => void;
		};
		km.registerLayer?.({
			commands: {
				"kevin.open": {
					title: "Kevin — open",
					description: "Open the Kevin route",
				},
				"kevin.proposal.approve": { title: "Kevin — approve proposal" },
				"kevin.proposal.reject": { title: "Kevin — reject proposal" },
				"kevin.conflict.acknowledge": { title: "Kevin — acknowledge conflict" },
			},
			bindings: {
				"kevin.open": "k",
			},
		});
	} catch {
		// best-effort
	}

	// Expose mailbox writers via command handlers (invoked from palette or future JSX buttons).
	// These are also callable from tests via exported helpers — the route render's interactive dialogs
	// would call the same writeMailboxAction in a real host with DialogConfirm/Select.
	void writeMailboxAction;

	// Attach helper closures to api for potential solid JSX callbacks (not part of typed API — cast).
	const extended = api as unknown as {
		kevinTui?: {
			approve: (proposalId: string, token: string) => void;
			reject: (proposalId: string, token: string, note?: string) => void;
			acknowledge: (conflictId: string) => void;
		};
	};
	extended.kevinTui = {
		approve: (proposalId: string, token: string) => {
			writeMailboxAction({ type: "approve", proposalId, token });
			toast("queued — applies at session idle", "info");
		},
		reject: (proposalId: string, token: string, note?: string) => {
			writeMailboxAction(
				note !== undefined
					? { type: "reject", proposalId, token, note }
					: { type: "reject", proposalId, token },
			);
			toast("queued — applies at session idle", "info");
		},
		acknowledge: (conflictId: string) => {
			writeMailboxAction({ type: "acknowledge", conflictId });
			toast("queued — applies at session idle", "info");
		},
	};
};

export default { id: "opencode-kevin", tui };
