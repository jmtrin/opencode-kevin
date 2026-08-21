import { type Dirent, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	type HookName,
	type HookReport,
	reduceVerdict,
} from "./HookLiveness.js";
import { HOOK_NAMES } from "./Migrate.js";
import type { Store } from "./Store.js";
import type { HostSurface } from "./host.js";
import type { SettingsReader } from "./native.js";

// v0.9.0 (K9-018 / plan §5.5, D9-09)
//
// kevin_doctor — the release's user-visible payoff. Pure reads, no
// writes, no probe re-run, no model call: safe to invoke at any time,
// and the output is designed to be pasted into an issue report — no
// filesystem paths, no session ids, no project ids.
//
// Every block degrades gracefully: a missing table (pre-010 DB) yields
// empty blocks rather than a throw, and the `partial` flag records that
// the report could not see everything.

export interface DoctorHook {
	readonly hook: string;
	readonly experimental: boolean;
	readonly state: "live" | "dead" | "unknown";
	readonly fire_count: number;
	readonly expected_count: number;
	readonly since?: string;
}

export interface DoctorReport {
	readonly host: {
		readonly plugin_version: string | null;
		readonly flavour: string;
		readonly shell_available: boolean;
		readonly v2: { readonly skill: boolean; readonly reference: boolean };
	};
	readonly hooks: DoctorHook[];
	readonly dependencies: {
		readonly declared: string[];
		readonly zod_copies: number | null;
		readonly note?: string;
	};
	readonly native: {
		readonly enabled: boolean;
		readonly registered: {
			readonly skill: boolean;
			readonly reference: boolean;
		};
		readonly verified: { readonly skill: boolean; readonly reference: boolean };
	};
	readonly verdict: "healthy" | "degraded" | "unknown";
	readonly reason: string;
	readonly partial: boolean;
}

/** Dead first, then unknown, then live — the failure is the first thing
 * on screen. Ties break on the canonical hook name. */
const STATE_ORDER: Record<DoctorHook["state"], number> = {
	dead: 0,
	unknown: 1,
	live: 2,
};

interface LivenessRow {
	hook: string;
	experimental: number;
	fire_count: number;
	expected_count: number;
	dead_since: string | null;
}

/** The hooks block is pure SQL over the persisted hook_liveness table:
 * the dead flag is materialized at expect() time (K9-010) so flush() can
 * persist dead_since even when report() never runs — this block reads
 * that persisted state, independent of any live HookLiveness object. */
function hooksBlock(store: Store): { hooks: DoctorHook[]; partial: boolean } {
	let rows: LivenessRow[] = [];
	try {
		rows = store
			.prepare(
				"SELECT hook, experimental, fire_count, expected_count, dead_since FROM hook_liveness",
			)
			.all() as LivenessRow[];
	} catch {
		return { hooks: [], partial: true };
	}
	// Only hooks the plugin knows about are reported; a foreign row (from
	// a future release) is skipped, mirroring HookLiveness.loadFromDb.
	const reports: HookReport[] = rows
		.filter((row): row is LivenessRow & { hook: HookName } =>
			HOOK_NAMES.includes(row.hook as HookName),
		)
		.map((row) => ({
			hook: row.hook,
			experimental: row.experimental === 1,
			state:
				row.fire_count > 0
					? "live"
					: row.dead_since !== null
						? "dead"
						: "unknown",
			firstSeenAt: null,
			lastSeenAt: null,
			fireCount: row.fire_count,
			expectedCount: row.expected_count,
			deadSince: row.dead_since,
		}));
	reports.sort(
		(a, b) =>
			STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
			a.hook.localeCompare(b.hook),
	);
	const hooks: DoctorHook[] = reports.map((r) => ({
		hook: r.hook,
		experimental: r.experimental,
		state: r.state,
		fire_count: r.fireCount,
		expected_count: r.expectedCount,
		...(r.deadSince !== null ? { since: r.deadSince } : {}),
	}));
	return { hooks, partial: false };
}

/**
 * Count resolved zod copies under `cwd`'s dependency tree. The expected
 * value after K9-005 is 1; a second copy is exactly the regression this
 * field exists to catch. On any walk failure the count is `null` and the
 * note says so — never a guess.
 */
export function countZodCopies(cwd: string): {
	copies: number | null;
	note?: string;
} {
	try {
		if (!existsSync(cwd)) {
			return { copies: null, note: "zod resolution walk failed" };
		}
		const seen = new Set<string>();
		const stack: string[] = [cwd];
		let copies = 0;
		// Bounded walk: node_modules is normally shallow; nested copies
		// (node_modules/<pkg>/node_modules/zod) sit within a few levels.
		for (let depth = 0; stack.length > 0 && depth < 8; depth += 1) {
			const next: string[] = [];
			for (const dir of stack) {
				const nm = join(dir, "node_modules");
				if (!existsSync(nm)) continue;
				let entries: Dirent[] | undefined;
				try {
					entries = readdirSync(nm, { withFileTypes: true });
				} catch {
					continue;
				}
				for (const entry of entries) {
					if (!entry.isDirectory()) continue;
					if (entry.name === "zod") {
						const pkg = join(nm, "zod", "package.json");
						if (existsSync(pkg) && !seen.has(pkg)) {
							seen.add(pkg);
							copies += 1;
						}
					} else if (entry.name !== ".bin" && entry.name !== ".cache") {
						next.push(join(nm, entry.name));
					}
				}
			}
			stack.length = 0;
			stack.push(...next);
		}
		return { copies };
	} catch {
		return { copies: null, note: "zod resolution walk failed" };
	}
}

interface NativeRow {
	surface: "skill" | "reference";
	registered: number;
	verified: number;
}

function lastRegistration(
	store: Store,
	surface: "skill" | "reference",
): { registered: boolean; verified: boolean } {
	try {
		const row = store
			.prepare(
				"SELECT surface, registered, verified FROM native_registrations WHERE surface = ? ORDER BY attached_at DESC, id DESC LIMIT 1",
			)
			.get(surface) as NativeRow | undefined;
		if (!row) return { registered: false, verified: false };
		return { registered: row.registered === 1, verified: row.verified === 1 };
	} catch {
		return { registered: false, verified: false };
	}
}

export interface DoctorOptions {
	/** Directory to walk for zod copies; defaults to process.cwd(). */
	readonly zodRoot?: string;
}

export function buildDoctor(
	store: Store,
	host: HostSurface,
	settings: SettingsReader,
	options: DoctorOptions = {},
): DoctorReport {
	// The host block comes from the frozen probe result captured at
	// construction — kevin_doctor never re-probes (K9-004: probe once,
	// freeze, reuse).
	const hooks = hooksBlock(store);
	const verdict = reduceVerdict(
		hooks.hooks.map((h) => ({
			hook: h.hook as HookName,
			experimental: h.experimental,
			state: h.state,
			firstSeenAt: null,
			lastSeenAt: null,
			fireCount: h.fire_count,
			expectedCount: h.expected_count,
			deadSince: h.since ?? null,
		})),
	);
	const zod = countZodCopies(options.zodRoot ?? process.cwd());
	const enabled =
		settings.getSetting("native_registration_enabled", "0") === "1";
	return {
		host: {
			plugin_version: host.pluginVersion,
			flavour: host.flavour,
			shell_available: host.hasShell,
			v2: { skill: host.v2.skill, reference: host.v2.reference },
		},
		hooks: hooks.hooks,
		dependencies: {
			declared: ["@opencode-ai/plugin"],
			zod_copies: zod.copies,
			...(zod.note !== undefined ? { note: zod.note } : {}),
		},
		native: {
			enabled,
			registered: {
				skill: lastRegistration(store, "skill").registered,
				reference: lastRegistration(store, "reference").registered,
			},
			verified: {
				skill: lastRegistration(store, "skill").verified,
				reference: lastRegistration(store, "reference").verified,
			},
		},
		verdict: verdict.verdict,
		reason: verdict.reason,
		partial: hooks.partial,
	};
}
