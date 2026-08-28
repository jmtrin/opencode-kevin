// v1.2.0 (K12-003 / plan §4.2, D12-05) — snapshot flush (pure serialization + atomic write).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Metrics } from "./metrics.js";
import type { ConflictView, HealthView, ProposalView } from "./tui-types.js";

const CAP_BYTES = 512 * 1024;
const SNAP_FILES = [
	"proposals.json",
	"conflicts.json",
	"health.json",
	"meta.json",
] as const;

export interface FlushInput {
	readonly root: string;
	readonly proposals: readonly ProposalView[];
	readonly conflicts: readonly ConflictView[];
	readonly health: HealthView;
	readonly metrics?: Metrics | null;
	// Optional version string for meta.json — defaults to KEVIN_VERSION at call site.
	readonly version?: string;
}

export interface FlushResult {
	readonly written: string[];
	readonly skipped: string[];
}

function byteLen(s: string): number {
	return Buffer.byteLength(s, "utf8");
}

function atomicWrite(target: string, content: string): void {
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, target);
}

function truncateProposals(
	proposals: readonly ProposalView[],
	cap: number,
): readonly ProposalView[] {
	// Estimate JSON overhead without diffs to compute available budget.
	// We truncate diff fields proportionally to fit cap.
	const serialized = JSON.stringify(proposals);
	if (byteLen(serialized) <= cap) return proposals;
	// Compute total diff length
	const totalDiff = proposals.reduce((acc, p) => acc + byteLen(p.diff), 0);
	if (totalDiff === 0) return proposals;
	const overhead = byteLen(serialized) - totalDiff;
	const budget = Math.max(0, cap - overhead - 1024); // leave margin
	// Distribute budget proportionally
	const out: ProposalView[] = [];
	for (let i = 0; i < proposals.length; i++) {
		const p = proposals[i];
		const diffBytes = byteLen(p.diff);
		const share = Math.floor((diffBytes / totalDiff) * budget);
		// Ensure at least 100 bytes per entry if possible, else share
		const sliceBytes = Math.min(diffBytes, Math.max(share, 100));
		// Slice diff by bytes approximated via string length; diff is ascii mostly
		// so byte length ~ char length. Use char slice.
		const approxChars = Math.floor(
			(sliceBytes / Math.max(diffBytes, 1)) * p.diff.length,
		);
		const truncatedDiff = p.diff.slice(0, Math.max(0, approxChars));
		const needsTrunc = truncatedDiff.length < p.diff.length;
		out.push({
			...p,
			diff: needsTrunc ? `${truncatedDiff}\n…[truncated]` : p.diff,
			truncated: needsTrunc ? true : p.truncated,
		});
	}
	// If still over cap after proportional truncation, iteratively trim more
	let result = out;
	let ser = JSON.stringify(result);
	let iter = 0;
	while (byteLen(ser) > cap && iter < 5) {
		result = result.map((p) => {
			if (!p.diff || p.diff.length < 200) return p;
			const half = Math.floor(p.diff.length / 2);
			return {
				...p,
				diff: `${p.diff.slice(0, half)}\n…[truncated]`,
				truncated: true,
			};
		});
		ser = JSON.stringify(result);
		iter++;
	}
	return result;
}

export function flushSnapshots(input: FlushInput): FlushResult {
	const { root, proposals, conflicts, health, metrics, version } = input;
	const dir = join(root, "tui");
	mkdirSync(dir, { recursive: true });
	const generatedAt = new Date().toISOString();
	const written: string[] = [];
	const skipped: string[] = [];

	// Proposals — cap with truncation
	let propToWrite: readonly ProposalView[] = proposals;
	let propJson = JSON.stringify(propToWrite, null, 2);
	if (byteLen(propJson) > CAP_BYTES) {
		propToWrite = truncateProposals(proposals, CAP_BYTES - 1024);
		propJson = JSON.stringify(propToWrite, null, 2);
		if (byteLen(propJson) > CAP_BYTES) {
			// Still over after truncation: truncate further by dropping diffs entirely
			const minimal = propToWrite.map((p) => ({
				...p,
				diff: `${p.diff.slice(0, 500)}\n…[truncated]`,
				truncated: true,
			}));
			propJson = JSON.stringify(minimal, null, 2);
		}
	}
	atomicWrite(join(dir, "proposals.json"), propJson);
	written.push("proposals.json");

	// Conflicts
	let conflictsJson = JSON.stringify(conflicts, null, 2);
	if (byteLen(conflictsJson) > CAP_BYTES) {
		// Truncate summaries if needed
		const truncated = conflicts.map((c) => ({
			...c,
			a_summary: c.a_summary.slice(0, 500),
			b_summary: c.b_summary.slice(0, 500),
		}));
		conflictsJson = JSON.stringify(truncated, null, 2);
	}
	atomicWrite(join(dir, "conflicts.json"), conflictsJson);
	written.push("conflicts.json");

	// Health
	let healthJson = JSON.stringify(health, null, 2);
	if (byteLen(healthJson) > CAP_BYTES) {
		// Health should never exceed cap, but truncate counters if it does
		const truncatedHealth = {
			...health,
			counters: {},
		};
		healthJson = JSON.stringify(truncatedHealth, null, 2);
	}
	atomicWrite(join(dir, "health.json"), healthJson);
	written.push("health.json");

	// Meta
	const meta = {
		generatedAt,
		version: version ?? "1.2.0",
		files: SNAP_FILES.slice(0, 3),
	};
	atomicWrite(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
	written.push("meta.json");

	if (metrics) {
		try {
			metrics.incr("tui_snapshots_flushed");
		} catch {
			// best-effort
		}
	}

	return { written, skipped };
}

/**
 * Tolerant JSON reader used by tests and (duplicated) by the TUI.
 * Returns {data} on success, {error} on missing/corrupt.
 */
export function readJsonSafe(
	path: string,
): { data: unknown } | { error: "missing" | "corrupt" } {
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
