// ============================================================
// Kevin 0.2.0 — fingerprint (K2-003)
// ============================================================
// Deterministic, zero-dependency content hash used to dedup
// error memories and to throttle per-fingerprint reflection.
//
// We deliberately avoid node:crypto so the module is portable
// across plugin hosts and stays cheap. FNV-1a 64-bit gives a
// decent spread for short-to-medium error strings and is
// reproducible across runs and platforms (BigInt arithmetic).
// ============================================================

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MOD = 1n << 64n;

// ANSI CSI sequences (color codes, cursor moves, etc.).
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping requires matching the ESC (\x1b) control char by definition.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// Path-with-line-and-column references: `src/foo.ts:42:7` -> `.ts`.
// Matches any non-whitespace path prefix followed by a dotted
// extension and `:NN` or `:NN:NN` line/column markers. Useful for
// stripping absolute or per-repo paths before fingerprinting so
// the same error text in two repos/copy-paste edits hashes alike.
const PATH_LINE_RE = /[^\s:]*\.([a-z0-9]+):\d+(?::\d+)?/g;

// Whitespace collapse — preserves token order but ignores
// line-break and indentation differences.
const WS_RE = /\s+/g;

/**
 * Normalize an error/output string before fingerprinting.
 *
 * Steps:
 *   1. Strip ANSI CSI sequences.
 *   2. Lowercase (for case-insensitive matching of paths/extensions).
 *   3. Replace `<path>.<ext>:<line>[:<col>` with `.<ext>` so the same
 *      error thrown from different files hashes the same.
 *   4. Collapse all whitespace runs to a single space and trim.
 */
export function normalize(content: string): string {
	return content
		.replace(ANSI_RE, "")
		.toLowerCase()
		.replace(PATH_LINE_RE, ".$1")
		.replace(WS_RE, " ")
		.trim();
}

/**
 * Compute the FNV-1a 64-bit hash of `input`, returned as a 16-char
 * lowercase hex string (zero-padded to 64 bits).
 *
 * FNV-1a: hash = offset_basis; for each byte: hash ^= byte; hash *= prime (mod 2^64).
 */
export function fnv1a64(input: string): string {
	let hash = FNV_OFFSET_BASIS;
	for (let i = 0; i < input.length; i++) {
		const byte = input.charCodeAt(i) & 0xff;
		hash ^= BigInt(byte);
		hash = (hash * FNV_PRIME) % FNV_MOD;
	}
	// Encode as 16-char lowercase hex.
	return hash.toString(16).padStart(16, "0");
}

/**
 * Fingerprint an error/output string. Optionally salt the hash with
 * `project_id` so the same error text in two different projects
 * produces two distinct fingerprints (per decision D2-11/D2-14).
 *
 * Salt is prepended and separated by a NUL byte to avoid accidental
 * collisions where one project's name is a prefix of another's.
 */
export function fingerprint(content: string, project_id?: string): string {
	const normalized = normalize(content);
	const salted = project_id ? `${project_id}\u0000${normalized}` : normalized;
	return fnv1a64(salted);
}
