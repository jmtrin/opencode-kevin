// hostless capabilities shim — pure types for core isolation (K13-002)
export interface Capabilities {
	readonly skills: boolean;
	readonly references: boolean;
	readonly apiVersion: string | null;
	readonly permissionAsk?: boolean;
}
