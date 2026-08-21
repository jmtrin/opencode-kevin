import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// v0.9.0 (K9-002 / plan §3, D9-01) — every claim in this release about
// @opencode-ai/plugin's shape is derived from the RESOLVED package on disk,
// never from memory or docs (Task.md §2: "Host-surface assumptions").
// The suite reads files; it never imports the package's runtime.
const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve the package the way Node does for this project: the hoisted
// dependency tree under the repository's node_modules. vitest's module
// runner intercepts require.resolve/import.meta.resolve, so the package
// root is derived from the repo layout instead.
const REPO_ROOT = join(__dirname, "..", "..");
const PLUGIN_PKG = join(REPO_ROOT, "node_modules", "@opencode-ai", "plugin");
if (!existsSync(join(PLUGIN_PKG, "dist", "index.d.ts"))) {
	throw new Error(
		"@opencode-ai/plugin not found under node_modules — run npm install",
	);
}
const DIST = join(PLUGIN_PKG, "dist");
const PLUGIN_SRC = join(__dirname, "..", "..", "plugin");

const read = (rel: string): string => readFileSync(join(DIST, rel), "utf8");

const sha256 = (content: string): string =>
	createHash("sha256").update(content).digest("hex");

// The v2 subpath does not exist on hosts older than the release that added
// it. When it is absent the v2 assertions SKIP with a "v1-only host" label
// instead of failing, because absence is exactly what the probe is designed
// to detect (plan §5.1).
const V2_PROMISE_EXISTS = existsSync(join(DIST, "v2", "promise"));
const V2_EFFECT_EXISTS = existsSync(join(DIST, "v2", "effect"));

const v2Only = (name: string, fn: () => void): void => {
	if (V2_PROMISE_EXISTS && V2_EFFECT_EXISTS) {
		it(name, fn);
	} else {
		it.skip("v1-only host — dist/v2 absent from the resolved package", fn);
	}
};

describe("Host contract — @opencode-ai/plugin resolved on disk (K9-002)", () => {
	// plan §3.2 / D9-01 — v2's PluginContext exposes only options, agent,
	// aisdk, catalog, command, integration, plugin, reference and skill.
	// None of Kevin's seven integration points (tool.*, chat.message,
	// experimental.*, event, session lifecycle) exists there, which is why
	// the release does NOT migrate. This test is designed to fail one day:
	// its failure is the signal to revisit D9-01.
	v2Only(
		"PluginContext exposes no tool/chat/session/event domain (D9-01)",
		() => {
			const ctx = read("v2/promise/context.d.ts");
			const missing = ["tool", "chat", "session", "event"].filter((domain) =>
				ctx.match(new RegExp(`readonly ${domain}:`)),
			);
			expect(
				missing,
				`D9-01 violated: v2 PluginContext now exposes ${missing.join(", ")}. Re-evaluate the no-migration decision; a migration would delete Kevin's tool/chat/session/event integration.`,
			).toEqual([]);
		},
	);

	// plan §3.3 / D9-03 — dist/index.d.ts is SHA-256 identical across the
	// minors from 1.17.6 to 1.18.16 (9285 bytes). The recorded digest pins
	// the v1 surface: if a future host changes it, this fails before
	// anything subtler does.
	it("dist/index.d.ts matches the recorded 1.17.x digest (D9-03)", () => {
		const content = read("index.d.ts");
		expect(content.length).toBe(9285);
		const recorded = readFileSync(
			join(__dirname, "..", "fixtures", "host", "index.d.ts.sha256"),
			"utf8",
		)
			.trim()
			.toLowerCase();
		expect(sha256(content)).toBe(recorded);
	});

	// plan §3.5 / D9-05 — tool.schema IS the host's own zod: the namespace
	// re-exports it, which is what makes removing Kevin's zod declaration
	// safe (all 25 schema expressions go through tool.schema).
	it("dist/tool.d.ts declares `var schema: typeof z` (D9-05)", () => {
		const tool = read("tool.d.ts");
		expect(tool).toMatch(/\bvar schema: typeof z\b/);
		expect(tool).toMatch(/import \{ z \} from "zod"/);
	});

	// plan §3.6 — PluginInput carries `$: BunShell`, the shell the doc says
	// to prefer over process.cwd(). Kevin's zero-spawn property is a DECISION
	// made while holding the means to do otherwise; this assertion keeps the
	// sentence true: the surface exists, and nothing in plugin/ uses it.
	it("PluginInput declares `$: BunShell` and plugin/ has zero `input.$` references", () => {
		const indexDts = read("index.d.ts");
		expect(indexDts).toMatch(/\$: BunShell/);
		const sources = readdirSync(PLUGIN_SRC)
			.filter((f) => f.endsWith(".ts"))
			.map((f) => readFileSync(join(PLUGIN_SRC, f), "utf8"))
			.join("\n");
		expect(sources).not.toMatch(/input\$/);
	});

	// plan §3.2 / D9-04 — v2/effect types every hook through Effect.Effect
	// and imports from the beta runtime; v2/promise returns plain promises
	// and imports nothing. Kevin uses promise, never effect.
	v2Only(
		'v2/effect imports from "effect" but v2/promise does not (D9-04)',
		() => {
			const effectReg = read("v2/effect/registration.d.ts");
			expect(effectReg).toMatch(/from "effect"/);
			expect(effectReg).toMatch(/Effect\.Effect/);
			const promiseReg = read("v2/promise/registration.d.ts");
			expect(promiseReg).not.toMatch(/from "effect"/);
			expect(promiseReg).toMatch(/=> Promise<void>/);
		},
	);
});
