// K13-010 (D13-07) — single definition of session.idle step ORDER.
// Both adapter (live) and replay (hermetic) consume this pipeline so a re-order
// is visible in both paths. The audit demanded dedup of the hand-synced wiring.
//
// The pipeline is PURE sequencing: it receives injected step closures and runs
// them in ORDER, swallowing per-step errors (best-effort, same contract as the
// adapter's try/catch blocks around each idle sub-step).

export const IDLE_STEP_ORDER = [
	"ledger.settle",
	"archiver.run",
	"retrospective",
	"reflectors.boost",
	"reflectors.penalize",
	"patternMiner.mine",
	"conventionMiner.mine",
	"conflictDetector.detect",
	"causalChain.onSessionIdle",
	"mailbox",
	"curator.propose",
	"sharedLayer.import",
	"snapshots.flush",
	"sessionRecordedWork",
	"metrics.flush",
	"perf.flush",
	"liveness.flush",
] as const;

export type IdleStepName = (typeof IDLE_STEP_ORDER)[number];

export type IdlePipelineDeps = Partial<
	Record<IdleStepName, () => void | Promise<void>>
>;

/**
 * Run idle steps in canonical ORDER, executing only those present in deps.
 * Each step is best-effort: a throwing step is swallowed so the chain continues,
 * matching the adapter's `try { } catch { }` around each sub-step.
 */
export async function composeIdlePipeline(
	deps: IdlePipelineDeps,
	order: readonly IdleStepName[] = IDLE_STEP_ORDER,
): Promise<void> {
	for (const name of order) {
		const fn = deps[name];
		if (!fn) continue;
		try {
			await fn();
		} catch {
			// best-effort — identical to adapter's per-step try/catch
		}
	}
}
