/**
 * K10-018 — kevin_contract: the frozen surface, inspectable at runtime.
 *
 * Read-only. Returns the live contract with its digest and per-clause
 * stability/since/deprecation; with `clause`, one clause's full value.
 * No filesystem paths, no project ids, no LLM, no network.
 */
import {
	type PublicContract,
	contractDigest,
	describeContract,
} from "./contract.js";

export interface KevinContractDeps {
	packageVersion: string;
}

export interface KevinContractArgs {
	clause?: string;
	format?: "summary" | "full";
}

export function buildKevinContract(
	deps: KevinContractDeps,
	args: KevinContractArgs,
): Record<string, unknown> {
	const contract: PublicContract = describeContract();
	const digest = contractDigest(contract);
	const format = args.format ?? "summary";

	if (args.clause !== undefined) {
		const clause = contract.clauses.find((c) => c.id === args.clause);
		if (!clause) {
			return {
				error: "unknown_clause",
				clause: args.clause,
				known_clauses: contract.clauses.map((c) => c.id),
			};
		}
		return {
			contract_version: contract.contractVersion,
			digest,
			package_version: deps.packageVersion,
			clause: {
				id: clause.id,
				title: clause.title,
				stability: clause.stability,
				since: clause.since,
				...(clause.deprecated ? { deprecated: clause.deprecated } : {}),
				...(clause.replacement ? { replacement: clause.replacement } : {}),
				value: clause.value,
			},
		};
	}

	if (format === "full") {
		return {
			contract_version: contract.contractVersion,
			digest,
			package_version: deps.packageVersion,
			clauses: contract.clauses,
			deprecated: contract.clauses.filter((c) => c.deprecated).map((c) => c.id),
		};
	}

	return {
		contract_version: contract.contractVersion,
		digest,
		package_version: deps.packageVersion,
		clauses: contract.clauses.map((c) => ({
			id: c.id,
			title: c.title,
			stability: c.stability,
			since: c.since,
			...(c.deprecated ? { deprecated: c.deprecated } : {}),
		})),
		deprecated: contract.clauses.filter((c) => c.deprecated).map((c) => c.id),
	};
}
