/**
 * v1.0.0 (K10-027 / plan §5.7) — the untrusted-input boundary.
 *
 * One pure, total, idempotent escaping function per container Kevin
 * writes stored text into. Every function here is a fixed point after
 * one application — applying it twice equals applying it once — because
 * a re-curated memory passes through the boundary on every regeneration
 * and must not accumulate escaping.
 *
 * This module imports nothing and touches no filesystem. It is the
 * boundary; the single enforcement point is ArtifactWriter (D6-01).
 */

const ENTITY_HEADS = /&(?!(amp|lt|gt|#\d+);)/g;

/**
 * Neutralise text destined for the AGENTS.md marker block: HTML-escape
 * (the memory-format discipline, made idempotent) so the literal
 * `<!-- kevin:end -->` marker sequence and every comment terminator
 * lose their meaning inside the block. The line-level strip of anything
 * containing `kevin:begin`/`kevin:end` stays in
 * ArtifactWriter.sanitizeArtifactBody — it is a filter, not an escape.
 */
export function escapeForMarkerBlock(text: string): string {
	return text
		.replace(ENTITY_HEADS, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Neutralise fenced-code delimiters: any run of three or more backticks
 * or tildes would close (or open) a markdown fence around the rendered
 * block and let stored text masquerade as un-fenced document content.
 * Each byte of the run becomes its numeric HTML entity, which renders
 * identically but can never form a delimiter again.
 */
export function escapeForFence(text: string): string {
	return text
		.replace(/`{3,}/g, (run) => "&#96;".repeat(run.length))
		.replace(/~{3,}/g, (run) => "&#126;".repeat(run.length));
}

/**
 * Neutralise bytes that would terminate an OKF v2 line: newline,
 * carriage return and every other C0 control character become their
 * JSON-style escapes, so a statement can never split into a second
 * line even if a future writer forgets JSON.stringify. Quotation marks
 * and backslashes are deliberately NOT touched here — the OKF line is
 * canonical JSON and re-escaping them would corrupt parsing; JSON
 * already guarantees they stay inside the string.
 */
export function escapeForOkfLine(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: neutralising control bytes is this function's entire job
	return text.replace(/[\u0000-\u001f]/g, (c) => {
		if (c === "\n") return "\\n";
		if (c === "\r") return "\\r";
		if (c === "\t") return "\\t";
		return `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
	});
}
