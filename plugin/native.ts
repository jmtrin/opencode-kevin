import { type Materializer, SKILL_TOPIC } from "./Materializer.js";
import type { Store } from "./Store.js";
// v0.9.0 (K9-013 / plan §5.4, D9-02/D9-10/D9-11)
//
// The additive v2 surface. Everything here is an enhancement: with the
// default settings and a v1-only host this module produces no side
// effects and the release behaves byte-identically to v0.8.0.
//
// The v2 subpath is named ONLY in this file, and ONLY through a dynamic
// import (D9-11): on hosts that predate the subpath this module still
// loads and the import never executes. Containment is asserted by
// K9-013's source scan.
import type { HostSurface } from "./host.js";
import { uuidv7 } from "./uuid.js";

/** The surface `attachNative()` returned. `verified` is filled by the
 * read-back checks (K9-014/015) once the host ran `setup()`. */
export interface NativeRegistration {
	registered: { skill: boolean; reference: boolean };
	verified: { skill: boolean; reference: boolean };
	notes: string[];
}

/** Minimal settings reader — matches MemoryService.getSetting(key, fallback). */
export interface SettingsReader {
	getSetting(key: string, fallback?: string): string | null;
}

export interface NativeDeps {
	materializer: Materializer;
	settings: SettingsReader;
	/**
	 * v0.9.0 (K9-014 / plan §5.4) — reports the outcome of each surface
	 * registration once the host ran `setup()`. `registered` reflects
	 * whether the transform completed; `verified` whether the read-back
	 * (`draft.list()`) contained the provided source. The host's own
	 * `setup()` runs asynchronously, so this callback may fire after
	 * `attachNative()` resolved.
	 */
	onVerified?: (
		surface: "skill" | "reference",
		registered: boolean,
		verified: boolean,
	) => void;
	/**
	 * v0.9.0 (K9-017 / plan §6.2) — the persistence sink. When present,
	 * every surface outcome is appended to `native_registrations` and the
	 * two live counters are bumped. Attach time is construction, not a
	 * hot path, so a direct write is correct here and the
	 * `metrics.flush()` cadence does not apply.
	 */
	store?: Store;
}

/** The only place in the repository allowed to name the v2 subpath. */
export const V2_SPECIFIER = "@opencode-ai/plugin/v2/promise";

/**
 * Duck-typed mirror of the host's v2 PluginContext. The host's own
 * compile-time types (dist/v2/promise/context.d.ts) are not importable
 * here — a static type import would name the specifier outside a dynamic
 * `import()` and break the containment scan.
 */
export interface KevinNativeContext {
	readonly skill: {
		transform(
			hook: (draft: unknown) => Promise<void> | void,
		): Promise<void> | void;
	};
	readonly reference: {
		transform(
			hook: (draft: unknown) => Promise<void> | void,
		): Promise<void> | void;
	};
}

/**
 * Duck-typed mirror of the v2 `Plugin` contract
 * (dist/v2/promise/plugin.d.ts). `define()` is the identity function —
 * 54 bytes, `return plugin` — so adopting it is neither a framework nor
 * a commitment (D9-02); the object literal below already satisfies the
 * contract.
 */
export interface KevinNativePlugin {
	readonly id: string;
	readonly setup: (context: KevinNativeContext) => Promise<void> | void;
}

/** The skill body Kevin registers through `skill.transform`. */
export function kevinSkillSource(materializer: Materializer): string {
	return materializer.skillBody();
}

/**
 * Build the v2 plugin. Registration replaces emission (D9-10): when the
 * host runs `setup()`, the skill/reference surfaces are registered
 * natively and the Materializer's `*_emission_enabled` file path is
 * skipped for those surfaces (guard in K9-016).
 */
export function buildNativePlugin(deps: NativeDeps): KevinNativePlugin {
	return {
		id: "opencode-kevin",
		setup: async (ctx) => {
			try {
				await ctx.skill.transform(async (draft) => {
					const source = kevinSkillSource(deps.materializer);
					// The draft is a mutable builder valid only for the
					// duration of this callback; it never escapes (D9-10
					// property 3). K9-014's source scan asserts that.
					const draftApi = draft as {
						source?: (s: string) => void;
						list?: () => readonly unknown[];
					};
					if (typeof draftApi.source !== "function") {
						deps.onVerified?.("skill", false, false);
						return;
					}
					draftApi.source(source);
					// v0.9.0 (K9-014 / plan §5.4 property 2) — verification is a
					// read-back: the registered source must show up in the
					// draft's own list(). An unverified registration is a note
					// (and a metric in K9-017), never a throw.
					const verified =
						typeof draftApi.list === "function" &&
						draftApi.list().some((entry: unknown) => entry === source);
					deps.onVerified?.("skill", true, verified);
				});
			} catch {
				// A rejecting transform still reports, never throws (K9-014).
				deps.onVerified?.("skill", false, false);
			}
			try {
				await ctx.reference.transform(async (draft) => {
					// v0.9.0 (K9-015 / plan §5.4, D6-14) — one add() per
					// materialized ref target (topic !== SKILL_TOPIC), named
					// `@kevin/<topic>`. Topics follow the v0.6.0 rule
					// `<type>-<dominant token>`; dominantToken already
					// excludes hex-like tokens, so a fingerprint prefix can
					// never become a reference name. Sources use the v2
					// `{ type: "local", path }` shape (read from the
					// resolved SDK's ReferenceLocalSource, duck-typed).
					const draftApi = draft as {
						add?: (name: string, source: unknown) => void;
						list?: () => readonly unknown[];
						remove?: (name: string) => void;
					};
					if (typeof draftApi.add !== "function") {
						deps.onVerified?.("reference", false, false);
						return;
					}
					const added: string[] = [];
					for (const target of deps.materializer.bundleTargets()) {
						if (target.topic === SKILL_TOPIC) continue;
						const name = `@kevin/${target.topic}`;
						draftApi.add(name, {
							type: "local",
							path: target.path,
						});
						added.push(name);
					}
					// Verification is the same read-back as K9-014: every
					// name we added must show up in the draft's own list().
					const listed =
						typeof draftApi.list === "function" ? draftApi.list() : [];
					const listedNames = new Set(
						listed.map((entry: unknown) => {
							const tuple = entry as readonly [string, unknown];
							return tuple[0];
						}),
					);
					const verified = added.every((name) => listedNames.has(name));
					deps.onVerified?.("reference", true, verified);
				});
			} catch {
				deps.onVerified?.("reference", false, false);
			}
		},
	};
}

export interface AttachOptions {
	/** Injectable v2 loader for tests; defaults to the real dynamic import. */
	importV2?: () => Promise<unknown>;
	/** Collects notes for the caller when the result is null. */
	notes?: string[];
}

/**
 * Attach the native surface when the host exposes it AND the user asked
 * for it. Returns `null` — cleanly, with a `note` — whenever the host
 * lacks the subpath or `native_registration_enabled` is not `'1'`; that
 * is the default on every existing installation, so the default
 * behaviour of this release is byte-identical to v0.8.0. Never throws
 * (D9-12): every failure path is a `null` plus a `note`.
 */
export async function attachNative(
	host: HostSurface,
	deps: NativeDeps,
	options: AttachOptions = {},
): Promise<NativeRegistration | null> {
	const notes = options.notes ?? [];
	const enabled =
		deps.settings.getSetting("native_registration_enabled", "0") === "1";
	if (!enabled) return null;

	if (!host.v2.skill && !host.v2.reference) {
		notes.push(
			"v2 subpath absent from the resolved host package — native registration skipped",
		);
		return null;
	}

	let mod: unknown;
	try {
		mod = await (
			options.importV2 ?? (() => import(/* @vite-ignore */ V2_SPECIFIER))
		)();
	} catch {
		notes.push("v2 subpath import rejected — native registration skipped");
		return null;
	}

	const record = mod as Record<string, unknown>;
	const define =
		typeof record.define === "function"
			? (record.define as (plugin: unknown) => unknown)
			: null;
	if (define === null) {
		notes.push("v2 module exposes no define() — native registration skipped");
		return null;
	}

	// `define()` is the identity function (D9-02): passing the built
	// plugin through it validates the contract without adding a framework.
	// v0.9.0 (K9-014 / plan §5.4 property 2) — the collector for the
	// read-back results: `verified` is filled by the host running setup()
	// (draft.list()), reported back through onVerified. The setup callback
	// may fire after this function resolved; the caller keeps the returned
	// registration as the final word.
	const registered = { skill: host.v2.skill, reference: host.v2.reference };
	const verified = { skill: false, reference: false };
	const plugin = buildNativePlugin({
		...deps,
		onVerified: (
			surface: "skill" | "reference",
			didRegister: boolean,
			isVerified: boolean,
		) => {
			if (!didRegister) registered[surface] = false;
			verified[surface] = isVerified;
			if (!isVerified) {
				notes.push(
					`${surface} read-back does not contain the provided source — unverified registration`,
				);
			}
			// v0.9.0 (K9-017 / plan §6.2) — append the outcome row at attach
			// time (construction, not a hot path; a direct write is correct,
			// the flush cadence does not apply). Only surfaces the host
			// actually exposes are persisted: a surface the host cannot
			// serve is not an outcome to record.
			if (deps.store && host.v2[surface]) {
				const note = !isVerified
					? `${surface} read-back does not contain the provided source — unverified registration`
					: null;
				persistRegistration(deps.store, surface, didRegister, isVerified, note);
			}
		},
	});
	define(plugin);

	return {
		registered,
		verified,
		notes,
	};
}

/**
 * v0.9.0 (K9-017 / plan §6.2) — one `native_registrations` row per
 * surface per attach attempt, plus the two live counters. The counters
 * live OUTSIDE the frozen `METRIC_KEYS` ladder (K7-004) but persist to
 * the same `kevin_metrics` table, following the v0.6.0 `incrRegistered`
 * precedent (K6-018/019): written immediately, never debounced. The
 * `surface` CHECK lives in the schema (migration 010), so a bad surface
 * fails loudly at the constraint rather than being coerced — the closed
 * enumeration is deliberate (plan §6.2).
 */
function persistRegistration(
	store: Store,
	surface: "skill" | "reference",
	registered: boolean,
	verified: boolean,
	note: string | null,
): void {
	store
		.prepare(
			`INSERT INTO native_registrations (id, surface, registered, verified, note)
			 VALUES (?, ?, ?, ?, ?)`,
		)
		.run(uuidv7(), surface, registered ? 1 : 0, verified ? 1 : 0, note);
	if (verified) {
		bumpNativeCounter(store, "native_registrations_total");
	} else if (registered) {
		// "Registered but unverified": the host accepted the call and did
		// not honour it — the interesting state (K9-017).
		bumpNativeCounter(store, "native_registration_failures");
	}
}

function bumpNativeCounter(store: Store, key: string): void {
	store
		.prepare(
			`INSERT INTO kevin_metrics (key, value, updated_at)
			 VALUES (?, 1, datetime('now'))
			 ON CONFLICT(key) DO UPDATE SET
			   value = value + excluded.value,
			   updated_at = datetime('now')`,
		)
		.run(key);
}
