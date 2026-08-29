/**
 * K6-016 — v0.6.0 pull — v2 domain probe (plan §5.7, D6-13).
 *
 * Duck-typed, exception-safe, zero-throw. Inspects the plugin input object
 * for a `skill` domain exposing a callable `source` and a `reference` domain
 * exposing a callable `add`. It never imports a v2 type, never dereferences
 * without a guard, and never throws — an unexpected shape returns the
 * all-false result.
 */

export interface Capabilities {
	readonly skills: boolean;
	readonly references: boolean;
	readonly apiVersion: string | null;
	/** v1.2.0 (K12-012 / plan D12-03) — additive probe for permission.ask. */
	readonly permissionAsk?: boolean;
}

const ALL_FALSE: Capabilities = {
	skills: false,
	references: false,
	apiVersion: null,
	permissionAsk: false,
};

function hasCallable(
	input: Record<string, unknown>,
	domainKey: string,
	memberKey: string,
): boolean {
	const domain = input[domainKey];
	return (
		typeof domain === "object" &&
		domain !== null &&
		typeof (domain as Record<string, unknown>)[memberKey] === "function"
	);
}

export function probe(input: unknown): Capabilities {
	if (typeof input !== "object" || input === null) {
		return ALL_FALSE;
	}
	try {
		const record = input as Record<string, unknown>;
		const apiVersion =
			typeof record.apiVersion === "string"
				? (record.apiVersion as string)
				: null;
		const permissionAsk = hasCallable(record, "permission", "ask");
		return {
			skills: hasCallable(record, "skill", "source"),
			references: hasCallable(record, "reference", "add"),
			apiVersion,
			permissionAsk,
		};
	} catch {
		// a Proxy whose getter throws must degrade to the all-false result,
		// never propagate (zero-throw contract, plan §5.7)
		return ALL_FALSE;
	}
}
