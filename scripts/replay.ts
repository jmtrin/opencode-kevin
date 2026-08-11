/**
 * v0.5.0 (K5-020 / plan §5.8, D5-12) — replay report.
 *
 * Runs every transcript under tests/replay/fixtures/ through the replay
 * harness and prints one aligned table row per transcript. This is a
 * REPORT, not a gate: the exit code is always 0. It never writes to the
 * user's home directory (replay defaults to an in-memory database).
 *
 * Usage: npm run replay
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../plugin/replay-types.js";
import { replay } from "../plugin/replay.js";

const fixturesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"tests",
	"replay",
	"fixtures",
);

async function main(): Promise<void> {
	const files = readdirSync(fixturesDir)
		.filter((f) => f.endsWith(".json"))
		.sort();

	if (files.length === 0) {
		console.log("No transcripts under tests/replay/fixtures/.");
		return;
	}

	const rows: Array<{
		name: string;
		memories: number;
		total: number;
		effective: number;
		ineffective: number;
		inconclusive: number;
		unmeasured: number;
		precision: string;
		coverage: string;
		prePromptTokens: number;
		compactingTokens: number;
	}> = [];

	for (const file of files) {
		const transcript = parseTranscript(
			JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as unknown,
		);
		const result = await replay(transcript);
		rows.push({
			name: result.transcript,
			memories: result.memoriesCreated,
			total: result.injections.total,
			effective: result.injections.effective,
			ineffective: result.injections.ineffective,
			inconclusive: result.injections.inconclusive,
			unmeasured: result.injections.unmeasured,
			precision: result.precisionRate.toFixed(3),
			coverage: result.coverageRate.toFixed(3),
			prePromptTokens: result.tokensInjected.prePrompt,
			compactingTokens: result.tokensInjected.compacting,
		});
	}

	const header = [
		"transcript",
		"memories",
		"total",
		"eff",
		"ineff",
		"inconc",
		"unmeas",
		"precision",
		"coverage",
		"pre_tokens",
		"comp_tokens",
	];
	const widths = header.map((h, i) =>
		Math.max(
			h.length,
			...rows.map(
				(r) =>
					String(
						[
							r.name,
							r.memories,
							r.total,
							r.effective,
							r.ineffective,
							r.inconclusive,
							r.unmeasured,
							r.precision,
							r.coverage,
							r.prePromptTokens,
							r.compactingTokens,
						][i],
					).length,
			),
		),
	);
	const pad = (s: string, i: number): string => s.padEnd(widths[i] ?? 0);

	console.log(header.map(pad).join("  "));
	console.log(widths.map((w) => "-".repeat(w)).join("  "));
	for (const r of rows) {
		const cells = [
			r.name,
			r.memories,
			r.total,
			r.effective,
			r.ineffective,
			r.inconclusive,
			r.unmeasured,
			r.precision,
			r.coverage,
			r.prePromptTokens,
			r.compactingTokens,
		];
		console.log(cells.map((c, i) => pad(String(c), i)).join("  "));
	}
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
