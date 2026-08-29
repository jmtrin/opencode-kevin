// hostless host types shim for core isolation (K13-002)
// Keep types only — probe logic stays in adapter packages/plugin/src/host.ts
export type HostFlavour = "v1-only" | "v1+v2";
export interface HostProject {
	readonly id: string | null;
	readonly worktree: string | null;
	readonly directory: string | null;
}
export interface HostSurface {
	readonly pluginVersion: string | null;
	readonly flavour: HostFlavour;
	readonly project: HostProject;
	readonly hasShell: boolean;
	readonly v2: {
		readonly skill: boolean;
		readonly reference: boolean;
	};
	readonly notes: readonly string[];
}
export function summarize(s: HostSurface): string {
	const version = s.pluginVersion ?? "unknown";
	const shell = s.hasShell ? "yes" : "no";
	const skill = s.v2.skill ? "yes" : "no";
	const reference = s.v2.reference ? "yes" : "no";
	return `host plugin ${version}, flavour ${s.flavour}, shell ${shell}, v2 skill ${skill}, v2 reference ${reference}`;
}
