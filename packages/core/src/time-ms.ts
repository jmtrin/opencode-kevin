// v1.1.0 (K11-003/K11-004 / plan §5.2, D11-01) — millisecond helper.
// Readers prefer _ms and fall back to legacy second-granularity column.
// The helper is the single implementation imported by InjectionLedger and
// CausalChain (moved here in K11-004 to avoid duplication).
export function toMs(
	legacyValue: string | null | undefined,
	msValue: number | null | undefined,
): number | null {
	if (typeof msValue === "number" && !Number.isNaN(msValue)) return msValue;
	if (!legacyValue) return null;
	// SQLite datetime('now') is 'YYYY-MM-DD HH:MM:SS' UTC
	const iso = legacyValue.includes("T")
		? legacyValue
		: `${legacyValue.replace(" ", "T")}Z`;
	const n = Date.parse(iso);
	return Number.isNaN(n) ? null : n;
}
