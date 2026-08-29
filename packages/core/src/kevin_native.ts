// v0.9.0 (K9-019 / plan §5.5, D9-12) — `kevin_native`: inspect and toggle
// `native_registration_enabled`.
//
// Pure in the sense that matters: `show` reads only; `enable`/`disable`
// write `kevin_settings` and nothing else. Neither action re-attaches —
// the probe is frozen for the process lifetime (D9-12) — and the response
// says so explicitly, naming a restart as the requirement. `enable` on a
// host without the v2 subpath succeeds and reports the registration as
// inert: the setting is a statement of intent that becomes effective when
// the host catches up, and refusing would make it untestable on the
// majority of installations.
//
// The stored value is TEXT `'1'` or `'0'` — never a boolean, never
// `'true'` (kevin_settings.value is TEXT; compare with `=== "1"`).

import type { Store } from "./Store.js";
import type { HostSurface } from "./host.js";
import type { SettingsReader } from "./native.js";

export type NativeAction = "show" | "enable" | "disable";

export interface NativeRegistrationRow {
	readonly surface: "skill" | "reference";
	readonly registered: boolean;
	readonly verified: boolean;
	readonly attached_at: string | null;
}

export interface NativeReport {
	readonly action: NativeAction;
	/** The setting value: '1' or '0' as stored (TEXT). */
	readonly value: "1" | "0";
	/** Whether registration would be effective on THIS host (v2 subpath present). */
	readonly effective: boolean;
	/** Present when `effective` is false: why the intent is inert. */
	readonly reason?: string;
	/** The latest persisted outcome per surface (show only). */
	readonly registrations?: NativeRegistrationRow[];
	/** The restart note (enable/disable only). */
	readonly note?: string;
}

export interface NativeDeps {
	readonly host: HostSurface;
	readonly store: Store;
	readonly settings: SettingsReader;
}

function lastRows(store: Store): NativeRegistrationRow[] {
	try {
		return store
			.prepare(
				`SELECT surface, registered, verified, attached_at
				 FROM native_registrations
				 ORDER BY attached_at DESC, id DESC
				 LIMIT 20`,
			)
			.all()
			.map((row) => {
				const r = row as {
					surface: "skill" | "reference";
					registered: number;
					verified: number;
					attached_at: string | null;
				};
				return {
					surface: r.surface,
					registered: r.registered === 1,
					verified: r.verified === 1,
					attached_at: r.attached_at,
				};
			});
	} catch {
		// pre-010 database: the table does not exist yet — no rows to
		// report, and that is the truth.
		return [];
	}
}

/** v0.9.0 (K9-019 / plan §5.5, D9-12) — the pure decision: the probe is
 * frozen for the process lifetime, so "effective" is derived from the
 * resolved host surface, never from a fresh probe call. */
function effectiveOn(host: HostSurface): boolean {
	return host.v2.skill || host.v2.reference;
}

export function handleNative(
	action: NativeAction,
	deps: NativeDeps,
): NativeReport {
	const current = deps.settings.getSetting("native_registration_enabled", "0");
	const value: "1" | "0" = current === "1" ? "1" : "0";

	if (action === "show") {
		const report: NativeReport = {
			action,
			value,
			effective: effectiveOn(deps.host),
			registrations: lastRows(deps.store),
			...(effectiveOn(deps.host)
				? {}
				: {
						reason:
							"v2 subpath absent from the resolved host package — registration would be inert",
					}),
		};
		return report;
	}

	const next: "1" | "0" = action === "enable" ? "1" : "0";
	deps.store
		.prepare(
			`INSERT INTO kevin_settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		)
		.run("native_registration_enabled", next);

	const report: NativeReport = {
		action,
		value: next,
		effective: effectiveOn(deps.host),
		note: "the probe is frozen for the process lifetime — restart the host for the change to take effect",
		...(effectiveOn(deps.host)
			? {}
			: {
					reason:
						"v2 subpath absent from the resolved host package — registration would be inert",
				}),
	};
	return report;
}
