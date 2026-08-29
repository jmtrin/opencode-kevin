// v0.6.0 (K6-006 / plan §5.2, D6-05) — a minimal deterministic unified-diff
// generator. Pure, dependency-free, byte-for-byte compatible with
// `git diff -U3 --no-index` for the fixtures the tests compare.
//
// It exists for exactly one reason: approval prompts must show a diff, never
// prose (D6-05). Determinism is a hard requirement: the output is persisted
// into `curation_proposals.diff` and compared across runs. No timestamps, no
// `Object.keys` iteration, no `Set` iteration — arrays only.

type DiffOp =
	| { type: "ctx"; line: string }
	| { type: "del"; line: string }
	| { type: "add"; line: string };

const CONTEXT = 3;

/**
 * Split text into logical lines. A trailing newline is not part of the line
 * model, so a file that merely gains or loses its final newline produces no
 * spurious final-line hunk.
 */
function linesOf(text: string): string[] {
	if (text === "") return [];
	const parts = text.split("\n");
	if (parts[parts.length - 1] === "") parts.pop();
	return parts;
}

/**
 * LCS over lines via dynamic programming, then a deterministic walk emitting
 * context / deletion / addition ops. Within each change region deletions are
 * emitted before additions, matching git's block ordering exactly.
 */
function computeOps(a: string[], b: string[]): DiffOp[] {
	const m = a.length;
	const n = b.length;
	const w = n + 1;
	const dp = new Int32Array((m + 1) * w);
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			dp[i * w + j] =
				a[i] === b[j]
					? dp[(i + 1) * w + j + 1] + 1
					: Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
		}
	}
	const ops: DiffOp[] = [];
	const pendingDel: string[] = [];
	const pendingAdd: string[] = [];
	const flush = (): void => {
		for (const line of pendingDel) ops.push({ type: "del", line });
		for (const line of pendingAdd) ops.push({ type: "add", line });
		pendingDel.length = 0;
		pendingAdd.length = 0;
	};
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			flush();
			ops.push({ type: "ctx", line: a[i] });
			i++;
			j++;
		} else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
			pendingDel.push(a[i]);
			i++;
		} else {
			pendingAdd.push(b[j]);
			j++;
		}
	}
	flush();
	while (i < m) {
		pendingDel.push(a[i]);
		i++;
	}
	flush();
	while (j < n) {
		pendingAdd.push(b[j]);
		j++;
	}
	flush();
	return ops;
}

interface Hunk {
	header: string;
	lines: string[];
}

function buildHunks(ops: DiffOp[]): Hunk[] {
	// Maximal change regions: runs of ops containing at least one del/add.
	const regions: Array<[number, number]> = [];
	let regionStart = -1;
	for (let k = 0; k < ops.length; k++) {
		if (ops[k].type !== "ctx") {
			if (regionStart === -1) regionStart = k;
		} else if (regionStart !== -1) {
			regions.push([regionStart, k]);
			regionStart = -1;
		}
	}
	if (regionStart !== -1) regions.push([regionStart, ops.length]);

	// Extend each region by CONTEXT lines and merge overlapping windows.
	const windows: Array<{ start: number; end: number }> = [];
	for (const [rs, re] of regions) {
		const start = Math.max(0, rs - CONTEXT);
		const end = Math.min(ops.length, re + CONTEXT);
		const prev = windows[windows.length - 1];
		if (prev !== undefined && start <= prev.end) {
			prev.end = end;
		} else {
			windows.push({ start, end });
		}
	}

	const hunks: Hunk[] = [];
	for (const win of windows) {
		let beforeStart = 0;
		let afterStart = 0;
		let countA = 0;
		let countB = 0;
		for (let k = 0; k < win.end; k++) {
			const op = ops[k];
			const inside = k >= win.start;
			if (op.type === "del") {
				if (!inside) beforeStart++;
				if (inside) countA++;
			} else if (op.type === "add") {
				if (!inside) afterStart++;
				if (inside) countB++;
			} else {
				if (!inside) {
					beforeStart++;
					afterStart++;
				}
				if (inside) {
					countA++;
					countB++;
				}
			}
		}
		// 1-based start lines; a side with zero lines starts at 0.
		const startA = countA > 0 ? beforeStart + 1 : 0;
		const startB = countB > 0 ? afterStart + 1 : 0;
		const rangeA = countA === 1 ? `-${startA}` : `-${startA},${countA}`;
		const rangeB = countB === 1 ? `+${startB}` : `+${startB},${countB}`;
		const lines: string[] = [];
		for (let k = win.start; k < win.end; k++) {
			const op = ops[k];
			if (op.type === "del") lines.push(`-${op.line}`);
			else if (op.type === "add") lines.push(`+${op.line}`);
			else lines.push(` ${op.line}`);
		}
		hunks.push({ header: `@@ ${rangeA} ${rangeB} @@`, lines });
	}
	return hunks;
}

/**
 * Unified diff between `before` and `after` for `path`, in git's format:
 * `--- a/<path>` / `+++ b/<path>` headers, `@@ -l,s +l,s @@` hunk headers
 * (count omitted when 1, `0,0` for an empty side), three lines of context and
 * adjacent hunks merged when their context windows overlap. Identical inputs
 * yield the empty string.
 */
export function unifiedDiff(
	path: string,
	before: string,
	after: string,
): string {
	const ops = computeOps(linesOf(before), linesOf(after));
	const hunks = buildHunks(ops);
	if (hunks.length === 0) return "";
	const parts: string[] = [];
	for (const hunk of hunks) {
		parts.push(hunk.header);
		parts.push(...hunk.lines);
	}
	const header = `--- a/${path}\n+++ b/${path}\n`;
	return `${header}${parts.join("\n")}\n`;
}
