// v1.2.0 (K12-017 / plan §4.4 R2, D12-10) — static dashboard generator.
// Single self-contained file: inline CSS/JS, snapshot data embedded as const DATA.
// Zero network: no fetch, no XHR, no WebSocket, no external asset.

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TuiSnapshotSet } from "./tui-types.js";

const CAP_BYTES = 512 * 1024;

function byteLen(s: string): number {
	return Buffer.byteLength(s, "utf8");
}

// HTML escaping — mirrors escapeInjectedText discipline (C-09 family).
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function proposalToken(
	proposalId: string,
	proposedText: string,
): string {
	return createHash("sha256")
		.update(`${proposalId}\0${proposedText}`, "utf8")
		.digest("hex")
		.slice(0, 16);
}

function truncateForHtml(views: TuiSnapshotSet, cap: number): TuiSnapshotSet {
	// Estimate html size; if over cap, truncate diffs progressively.
	let html = renderDashboardInner(views, false);
	if (byteLen(html) <= cap) return views;
	// First pass: cap diffs to 2000 chars
	let truncated = {
		...views,
		proposals: views.proposals.map((p) => {
			if (p.diff.length <= 2000) return p;
			return {
				...p,
				diff: `${p.diff.slice(0, 2000)}\n…[truncated]`,
				truncated: true,
			};
		}),
	};
	html = renderDashboardInner(truncated, false);
	if (byteLen(html) <= cap) return truncated;
	// Second: 800 chars
	truncated = {
		...views,
		proposals: views.proposals.map((p) => ({
			...p,
			diff:
				p.diff.length > 800 ? `${p.diff.slice(0, 800)}\n…[truncated]` : p.diff,
			truncated: p.diff.length > 800 ? true : p.truncated,
		})),
		conflicts: views.conflicts.map((c) => ({
			...c,
			a_summary: c.a_summary.slice(0, 200),
			b_summary: c.b_summary.slice(0, 200),
		})),
	};
	html = renderDashboardInner(truncated, false);
	if (byteLen(html) <= cap) return truncated;
	// Third: drop diffs to 400 chars
	truncated = {
		...views,
		proposals: views.proposals.map((p) => ({
			...p,
			diff: `${p.diff.slice(0, 400)}\n…[truncated]`,
			truncated: true,
		})),
	};
	return truncated;
}

function renderDashboardInner(
	views: TuiSnapshotSet,
	_withTruncation: boolean,
): string {
	const css =
		"*{box-sizing:border-box}body{font-family:ui-monospace,monospace;margin:0;padding:16px;background:#0f1115;color:#e6e6e6}a{color:#8ab4ff}header{border-bottom:1px solid #2a2e39;padding-bottom:12px;margin-bottom:16px}h1{margin:0;font-size:20px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #222;padding-bottom:4px}.card{border:1px solid #2a2e39;border-radius:8px;padding:12px;margin:8px 0;background:#151821}.muted{color:#9aa0b2;font-size:12px}.badge{display:inline-block;padding:2px 6px;border-radius:999px;font-size:11px;border:1px solid #2a2e39}.badge-healthy{background:#12331a;color:#8ef0a0}.badge-degraded{background:#331a1a;color:#f0a0a0}.badge-unknown{background:#2a2a33;color:#c0c0d0}pre{white-space:pre-wrap;word-break:break-word;background:#0b0d12;padding:8px;border-radius:6px;overflow:auto;max-height:320px;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #2a2e39;padding:4px 6px;text-align:left}button{cursor:pointer;background:#1f2330;color:#e6e6e6;border:1px solid #2a2e39;border-radius:6px;padding:4px 8px;font-size:12px}button:hover{background:#2a3045}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}.count{font-size:11px;color:#9aa0b2}";
	// Build proposals HTML server-side
	const proposalsHtml =
		views.proposals.length === 0
			? `<div class="muted">No pending proposals.</div>`
			: views.proposals
					.map((p) => {
						const token = p.token ?? proposalToken(p.id, p.diff);
						const approveCmd = `/kevin-approve ${p.id} ${token}`;
						const rejectCmd = `/kevin-reject ${p.id} ${token}`;
						return `<div class="card">
<div><strong>${escapeHtml(p.kind)}</strong> <span class="muted">${escapeHtml(p.id)}</span> <span class="badge">${escapeHtml(p.target_path)}</span> <span class="muted">${escapeHtml(p.created_at)}</span>${p.truncated ? ` <span class="badge">truncated</span>` : ""}</div>
<div class="muted">memories: ${escapeHtml(p.memory_ids.join(", "))}</div>
<pre>${escapeHtml(p.diff)}</pre>
<div style="display:flex;gap:8px;margin-top:8px">
<button data-copy="${escapeHtml(approveCmd)}" onclick="copyCmd(this)">Copy approve</button>
<button data-copy="${escapeHtml(rejectCmd)}" onclick="copyCmd(this)">Copy reject</button>
</div>
<div class="muted copy-hint"></div>
</div>`;
					})
					.join("\n");

	const conflictsHtml =
		views.conflicts.length === 0
			? `<div class="muted">No open conflicts.</div>`
			: views.conflicts
					.map((c) => {
						const ackCmd = `/kevin-ack ${c.id}`;
						return `<div class="card">
<div><strong>${escapeHtml(c.kind)}</strong> <span class="muted">${escapeHtml(c.id)}</span> <span class="muted">${escapeHtml(c.opened_at)}</span></div>
<div class="cols"><div><div class="muted">A</div><pre>${escapeHtml(c.a_summary)}</pre></div><div><div class="muted">B</div><pre>${escapeHtml(c.b_summary)}</pre></div></div>
<div style="margin-top:8px"><button data-copy="${escapeHtml(ackCmd)}" onclick="copyCmd(this)">Copy ack</button> <span class="muted copy-hint"></span></div>
</div>`;
					})
					.join("\n");

	const verdictClass =
		views.health.verdict === "healthy"
			? "badge-healthy"
			: views.health.verdict === "degraded"
				? "badge-degraded"
				: "badge-unknown";

	const hooksRows =
		views.health.hooks.length === 0
			? `<tr><td colspan="4" class="muted">No hooks</td></tr>`
			: views.health.hooks
					.map(
						(h) =>
							`<tr><td>${escapeHtml(h.hook)}</td><td>${escapeHtml(h.state)}</td><td>${h.fire_count}</td><td>${h.expected_count}</td></tr>`,
					)
					.join("\n");

	const perfRows =
		views.health.perf.length === 0
			? `<tr><td colspan="4" class="muted">No perf data</td></tr>`
			: views.health.perf
					.map(
						(p) =>
							`<tr><td>${escapeHtml(p.scope)}</td><td>${p.p95}</td><td>${p.budget_p95}</td><td>${p.within_budget ? "yes" : "no"}</td></tr>`,
					)
					.join("\n");

	const countersHtml =
		Object.keys(views.health.counters).length === 0
			? `<div class="muted">No counters</div>`
			: `<div class="grid">${Object.entries(views.health.counters)
					.map(
						([k, v]) =>
							`<div class="card"><div class="muted">${escapeHtml(k)}</div><div><strong>${v}</strong></div></div>`,
					)
					.join("\n")}</div>`;

	// Embedded DATA — escape every "<" to \u003c so hostile "<script>" can never appear verbatim inside the <script> block.
	const dataJson = JSON.stringify(views).replace(/</g, "\\u003c");

	const js = `function copyCmd(btn){var cmd=btn.getAttribute('data-copy');var hint=btn.parentElement.nextElementSibling;function done(t){if(hint)hint.textContent=t;setTimeout(function(){if(hint)hint.textContent='';},2500);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(cmd).then(function(){done('Copied: '+cmd+' — paste into your opencode session');},function(){fallback(cmd,done);});}else{fallback(cmd,done);}}function fallback(cmd,done){var ta=document.createElement('textarea');ta.value=cmd;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done('Copied: '+cmd+' — paste into your opencode session');}catch(e){done('Copy failed — manually copy: '+cmd);}document.body.removeChild(ta);}`;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kevin — Dashboard</title>
<style>${css}</style>
</head>
<body>
<header>
<h1>Kevin — Surface Dashboard</h1>
<div class="muted">Generated at ${escapeHtml(views.generatedAt)} · <span class="badge ${verdictClass}">${escapeHtml(views.health.verdict)}</span> ${escapeHtml(views.health.reason)} · contract ${escapeHtml(views.health.contract_digest)}</div>
<div class="muted">Proposals ${views.proposals.length} · Conflicts ${views.conflicts.length} · Paste copied <code>/kevin-*</code> commands into your opencode session (Desktop or CLI).</div>
</header>

<section>
<h2>Proposals</h2>
${proposalsHtml}
</section>

<section>
<h2>Conflicts</h2>
${conflictsHtml}
</section>

<section>
<h2>Health</h2>
<table><thead><tr><th>hook</th><th>state</th><th>fires</th><th>expected</th></tr></thead><tbody>${hooksRows}</tbody></table>
<table style="margin-top:12px"><thead><tr><th>scope</th><th>p95 ms</th><th>budget p95</th><th>within</th></tr></thead><tbody>${perfRows}</tbody></table>
<div style="margin-top:12px">${countersHtml}</div>
</section>

<script>const DATA=${dataJson};${js}</script>
</body>
</html>`;
}

export function renderDashboard(views: TuiSnapshotSet): string {
	const capped = truncateForHtml(views, CAP_BYTES);
	return renderDashboardInner(capped, true);
}

export function writeDashboard(root: string, views: TuiSnapshotSet): string {
	const dir = join(root, "tui");
	mkdirSync(dir, { recursive: true });
	const html = renderDashboard(views);
	const target = join(dir, "dashboard.html");
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, html, "utf8");
	renameSync(tmp, target);
	return target;
}
