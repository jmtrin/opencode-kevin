// v1.2.0 (K12-002 / plan §4.2-§4.3) — shared view types (type-only module).
// This file MUST contain only type/interface exports — zero runtime values.
// The TUI module may import it ONLY as `import type`.

export interface ProposalView {
	readonly id: string;
	readonly kind: string;
	readonly target_path: string;
	readonly diff: string;
	readonly memory_ids: readonly string[];
	readonly created_at: string;
	readonly truncated?: boolean;
	readonly token?: string;
}

export interface ConflictView {
	readonly id: string;
	readonly kind: string;
	readonly a_summary: string;
	readonly b_summary: string;
	readonly opened_at: string;
}

export interface HealthView {
	readonly verdict: string;
	readonly reason: string;
	readonly hooks: readonly {
		readonly hook: string;
		readonly state: string;
		readonly fire_count: number;
		readonly expected_count: number;
	}[];
	readonly perf: readonly {
		readonly scope: string;
		readonly p95: number;
		readonly budget_p95: number;
		readonly within_budget: boolean;
	}[];
	readonly contract_digest: string;
	readonly counters: Record<string, number>;
}

export interface TuiSnapshotSet {
	readonly generatedAt: string;
	readonly proposals: readonly ProposalView[];
	readonly conflicts: readonly ConflictView[];
	readonly health: HealthView;
}

export type TuiAction =
	| {
			readonly type: "approve";
			readonly proposalId: string;
			readonly token: string;
	  }
	| {
			readonly type: "reject";
			readonly proposalId: string;
			readonly token: string;
			readonly note?: string;
	  }
	| { readonly type: "acknowledge"; readonly conflictId: string };

export interface ActionResult {
	readonly action: TuiAction;
	readonly status: "applied" | "rejected" | "stale_skipped" | "error";
	readonly detail?: string;
}
