/**
 * v2.2.0 (K22-004 / plan §4.4, D22-03/D22-04) — Desktop instance isolation.
 *
 * Under OpenCode Desktop one server process hosts N instances and
 * `process.cwd()` is the SERVER's directory. Before the fix both factories
 * below resolved the server's remote/cwd (BUG-07: same `project_id`, same
 * `repo_id`, own `.git/config` remotes ignored) and the second `probeHost`
 * reused the first instance's project (BUG-08: process-global cache), while
 * `RepoIdentity.resolve` kept `projectId` on the cwd arg even when the
 * `repoId` came from the host (BUG-09).
 *
 * This test boots two factories in ONE process with different
 * `input.directory` values (each with its own `.git/config` remote, no
 * `projectRoot` override) and asserts per-instance identity plus export
 * isolation, alongside a CLI-equivalence case (`directory === cwd` resolves
 * byte-identically to a direct `RepoIdentity.resolve(process.cwd())`).
 */

import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";
import {
	computeRepoId,
	fingerprint,
	resolve as resolveIdentity,
} from "@jmtrin/kevin-core";
import type { PluginInput } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	probeHost,
	resetHostProbeCache,
} from "../../packages/plugin/src/host.js";
import { KevinPlugin } from "../../packages/plugin/src/index.js";

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-desktop-instances-"));
	resetHostProbeCache();
});

afterEach(() => {
	try {
		rmSync(tmpRoot, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

function makeMigrationsDir(): string {
	const dir = join(tmpRoot, "packages/core/migrations");
	mkdirSync(dir, { recursive: true });
	for (const file of readdirSync(
		join(process.cwd(), "packages/core/migrations"),
	)) {
		if (!file.endsWith(".sql")) continue;
		copyFileSync(
			join(process.cwd(), "packages/core/migrations", file),
			join(dir, file),
		);
	}
	return dir;
}

function writeGitRemote(projectDir: string, url: string): void {
	mkdirSync(join(projectDir, ".git"), { recursive: true });
	writeFileSync(
		join(projectDir, ".git", "config"),
		`[remote "origin"]\n\turl = ${url}\n`,
		"utf8",
	);
}

describe("K22-004 — two Desktop instances in one process stay scoped on their own projects", () => {
	it("resolves distinct projectId/repoId per input.directory and isolates kevin_export", async () => {
		const dirA = join(tmpRoot, "projA");
		const dirB = join(tmpRoot, "projB");
		writeGitRemote(dirA, "https://github.com/acme/projA.git");
		writeGitRemote(dirB, "https://github.com/acme/projB.git");
		const migrationsDir = makeMigrationsDir();
		const dbPath = join(tmpRoot, "shared.db");

		const hooksA = await KevinPlugin({ directory: dirA } as PluginInput, {
			dbPath,
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retro"),
		});
		const hooksB = await KevinPlugin({ directory: dirB } as PluginInput, {
			dbPath,
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retro"),
		});

		const showA = JSON.parse(
			(
				(await hooksA.tool?.kevin_project.execute(
					{ action: "show" },
					{} as never,
				)) as { output: string }
			).output,
		) as { project_id: string; repo_id: string; source: string };
		const showB = JSON.parse(
			(
				(await hooksB.tool?.kevin_project.execute(
					{ action: "show" },
					{} as never,
				)) as { output: string }
			).output,
		) as { project_id: string; repo_id: string; source: string };

		// Each instance sees its own project — never the server cwd.
		expect(showA.project_id).toBe(fingerprint(dirA));
		expect(showB.project_id).toBe(fingerprint(dirB));
		expect(showA.project_id).not.toBe(showB.project_id);
		expect(showA.project_id).not.toBe(fingerprint(process.cwd()));
		// Each instance reads its own .git/config remote (declared/remote win).
		expect(showA.source).toBe("remote");
		expect(showB.source).toBe("remote");
		expect(showA.repo_id).not.toBe(showB.repo_id);

		// Seed one memory per project scope through the public save path.
		const shared = new Store({ path: dbPath });
		try {
			const svc = new MemoryService(shared);
			svc.save({
				type: "decision",
				content: "alpha-project marker seven-seven-one",
				projectId: fingerprint(dirA),
			});
			svc.save({
				type: "decision",
				content: "beta-project marker nine-nine-two",
				projectId: fingerprint(dirB),
			});
		} finally {
			try {
				shared.close();
			} catch {
				/* ignore */
			}
		}

		// kevin_export from A carries A's memory and none of B's (K8-027).
		const outA = (await hooksA.tool?.kevin_export.execute(
			{ format: "okf" },
			{} as never,
		)) as { output: string };
		expect(outA.output).toContain("alpha-project marker seven-seven-one");
		expect(outA.output).not.toContain("beta-project marker nine-nine-two");

		await hooksA.dispose?.();
		await hooksB.dispose?.();
	});

	it("a keyless second probe no longer inherits the first instance's project", async () => {
		// BUG-08 regression: with a process-global cache the second probeHost
		// returned the first instance's directory even for another project.
		const first = await probeHost({ directory: join(tmpRoot, "projA") });
		expect(first.project.directory).toBe(join(tmpRoot, "projA"));
		const second = await probeHost({ directory: join(tmpRoot, "projB") });
		expect(second.project.directory).toBe(join(tmpRoot, "projB"));
		expect(second).not.toBe(first);
	});

	it("session identity uses the host directory when no remote is declared", async () => {
		// The Desktop case from triage with no .git remote: the SESSION must
		// scope on the host directory (source host), not the server cwd.
		// Observed via kevin_status, which reports the boot session identity.
		const dirA = join(tmpRoot, "bareA");
		const dirB = join(tmpRoot, "bareB");
		mkdirSync(dirA, { recursive: true });
		mkdirSync(dirB, { recursive: true });
		const migrationsDir = makeMigrationsDir();

		const hooksA = await KevinPlugin({ directory: dirA } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retro"),
		});
		const hooksB = await KevinPlugin({ directory: dirB } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retro"),
		});
		const statusA = JSON.parse(
			(
				(await hooksA.tool?.kevin_status.execute({}, {} as never)) as {
					output: string;
				}
			).output,
		) as { v08?: { repo_id: string; identity_source: string } };
		const statusB = JSON.parse(
			(
				(await hooksB.tool?.kevin_status.execute({}, {} as never)) as {
					output: string;
				}
			).output,
		) as { v08?: { repo_id: string; identity_source: string } };
		expect(statusA.v08?.identity_source).toBe("host");
		expect(statusB.v08?.identity_source).toBe("host");
		expect(statusA.v08?.repo_id).toBe(computeRepoId(dirA));
		expect(statusB.v08?.repo_id).toBe(computeRepoId(dirB));
		expect(statusA.v08?.repo_id).not.toBe(statusB.v08?.repo_id);
		await hooksA.dispose?.();
		await hooksB.dispose?.();
	});

	it("CLI single-project mode (directory === cwd) resolves identically to a direct resolve", async () => {
		// No behavior change where there was no bug: when the host directory
		// IS the server cwd, the factory identity matches v2.1.0 semantics.
		const migrationsDir = makeMigrationsDir();
		const hooks = await KevinPlugin(
			{ directory: process.cwd() } as PluginInput,
			{
				dbPath: ":memory:",
				migrationsDir,
				retrospectivesDir: join(tmpRoot, "retro"),
			},
		);
		const show = JSON.parse(
			(
				(await hooks.tool?.kevin_project.execute(
					{ action: "show" },
					{} as never,
				)) as { output: string }
			).output,
		) as { project_id: string; repo_id: string; source: string };
		// kevin_project show resolves host-less against projectRoot; with no
		// override projectRoot === projectDir === cwd here.
		const direct = resolveIdentity(process.cwd());
		expect(show.project_id).toBe(direct.projectId);
		await hooks.dispose?.();
	});

	it("empty-string directory falls back to cwd (v2.2.0 K22-004 audit fix)", async () => {
		// A host sending directory:"" must behave as if it sent nothing:
		// v2.1.0 ignored empty host fields via length>0 guards. Scoping on
		// fingerprint("") with relative .kevin/ joins would be silent corruption.
		const migrationsDir = makeMigrationsDir();
		const hooks = await KevinPlugin({ directory: "" } as PluginInput, {
			dbPath: ":memory:",
			migrationsDir,
			retrospectivesDir: join(tmpRoot, "retro"),
		});
		const show = JSON.parse(
			(
				(await hooks.tool?.kevin_project.execute(
					{ action: "show" },
					{} as never,
				)) as { output: string }
			).output,
		) as { project_id: string; repo_id: string; source: string };
		expect(show.project_id).toBe(fingerprint(process.cwd()));
		expect(show.project_id).not.toBe(fingerprint(""));
		await hooks.dispose?.();
	});
});
