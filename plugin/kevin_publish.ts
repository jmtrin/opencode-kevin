import type { ArtifactWriter } from "./ArtifactWriter.js";
import type { MaterializedBundle, Materializer } from "./Materializer.js";
import type { MemoryService } from "./MemoryService.js";
import type { Capabilities } from "./capabilities.js";

/**
 * K6-020 — v0.6.0 pull — `kevin_publish` tool logic.
 *
 * Regenerates the pull-channel bundles on demand. Writes only through the
 * `ArtifactWriter` and only to the Materializer's targets (D6-01, D6-07):
 * `~/.opencode-kevin/skills/project-knowledge.md` and
 * `~/.opencode-kevin/refs/<topic>.md`. `agents_md_path` is unreachable
 * here by construction — the paths come from `bundleTargets()`, never from
 * a setting — and that is asserted in the integration test even when the
 * setting points inside `~/.opencode-kevin/`.
 *
 * Registration is a session-start concern (K6-018/019), not this tool's:
 * the output reports the emission state honestly (`"unavailable"` on a v1
 * host, `"off"` for a '0' setting, `"on"` when session start registers)
 * instead of pretending success.
 */

export type EmissionState = "on" | "off" | "unavailable";

export interface PublishResult {
	readonly bundles: readonly {
		readonly topic: string;
		readonly outcome: MaterializedBundle["outcome"];
	}[];
	readonly emission: {
		readonly skill: EmissionState;
		readonly reference: EmissionState;
	};
}

export interface PublishDeps {
	readonly materializer: Materializer;
	readonly writer: ArtifactWriter;
	readonly memoryService: MemoryService;
	readonly capabilities: Capabilities;
}

function emissionState(
	capable: boolean,
	setting: string | undefined,
): EmissionState {
	if (!capable) return "unavailable";
	return setting === "1" ? "on" : "off";
}

export function kevinPublish(deps: PublishDeps): PublishResult {
	const bundles = deps.materializer.materialize(deps.writer);
	return {
		bundles: bundles.map((b) => ({
			topic: b.topic,
			outcome: b.outcome,
		})),
		emission: {
			skill: emissionState(
				deps.capabilities.skills,
				deps.memoryService.getSetting("skill_emission_enabled", "0"),
			),
			reference: emissionState(
				deps.capabilities.references,
				deps.memoryService.getSetting("reference_emission_enabled", "0"),
			),
		},
	};
}
