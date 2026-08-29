// hostless native types shim for core isolation (K13-002)
import type { Store } from "./Store.js";
import type { Materializer } from "./Materializer.js";
export interface NativeRegistration {
	registered: { skill: boolean; reference: boolean };
	verified: { skill: boolean; reference: boolean };
	notes: string[];
}
export interface SettingsReader {
	getSetting(key: string, fallback?: string): string | null;
}
export interface NativeDeps {
	materializer: Materializer;
	settings: SettingsReader;
	onVerified?: (surface: "skill" | "reference", registered: boolean, verified: boolean) => void;
	store?: Store;
}
export const V2_SPECIFIER = "@opencode-ai/plugin/v2/promise";
