// v1.1.0 (K11-008 / plan §5.4, D11-03) — pure comparator for benchmark regression
export interface BenchPoint {
	arm: string;
	precision_at_k: number;
	recall_at_k: number;
	mrr: number;
}

export interface CompareThresholds {
	p: number;
	r: number;
	mrr: number;
}

export function compareResults(
	prev: BenchPoint[],
	curr: BenchPoint[],
	thresholds: CompareThresholds = { p: 0.02, r: 0.05, mrr: 0.05 },
): { ok: boolean; failures: string[] } {
	const failures: string[] = [];
	const prevByArm = new Map(prev.map((b) => [b.arm, b]));
	const currByArm = new Map(curr.map((b) => [b.arm, b]));

	// Gating arm: "kevin" only
	const arm = "kevin";
	const p = prevByArm.get(arm);
	const c = currByArm.get(arm);
	if (!p) {
		// first-run case: missing prev is ok with warning
		failures.push(`warning: prev missing arm ${arm} (first run)`);
		// Actually for ok semantics, missing prev is not a failure; we push warning but ok true if only warning
		// To keep ok true when only warning, we will filter warnings out of failures decision
		// But spec says treat missing prev as ok with warning string; we return ok true and warning in failures?
		// Plan says: Include prev-missing-arm handling: treat missing prev as ok with a warning string (first-run case).
		// We will return ok true and failures contains warning but not considered gating failure?
		// For implementation we will treat warning as not failing: we return ok true and clear failures? Or keep warning?
		// Let's keep warning in failures but ok remains true if only warnings.
		return { ok: true, failures };
	}
	if (!c) {
		failures.push("kevin arm missing in curr");
		return { ok: false, failures };
	}

	const check = (
		metric: string,
		prevVal: number,
		currVal: number,
		threshold: number,
	) => {
		const drop = prevVal - currVal;
		if (drop > threshold) {
			failures.push(
				`${arm} ${metric} regression: prev=${prevVal.toFixed(4)} curr=${currVal.toFixed(4)} drop=${drop.toFixed(4)} threshold=${threshold.toFixed(4)}`,
			);
		}
	};

	check("precision@k", p.precision_at_k, c.precision_at_k, thresholds.p);
	check("recall@k", p.recall_at_k, c.recall_at_k, thresholds.r);
	check("mrr", p.mrr, c.mrr, thresholds.mrr);

	// Other arms are informational: record but never gate - we don't push failures for them
	// But we could add info to failures? Plan says other arms degraded → still ok (informational)
	// So we do nothing for other arms.

	const isOnlyWarning =
		failures.length === 1 && failures[0].startsWith("warning:");
	if (isOnlyWarning) return { ok: true, failures };

	return { ok: failures.length === 0, failures };
}
