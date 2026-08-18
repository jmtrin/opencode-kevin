import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeRepoId, resolve } from "../../plugin/RepoIdentity.js";
import { fingerprint, fnv1a64 } from "../../plugin/fingerprint.js";

let root: string;

function writeConfig(dir: string, body: string): void {
	const gitDir = join(dir, ".git");
	mkdirSync(gitDir, { recursive: true });
	writeFileSync(join(gitDir, "config"), body);
}

function writeProjectJson(dir: string, body: string): void {
	const kevinDir = join(dir, ".kevin");
	mkdirSync(kevinDir, { recursive: true });
	writeFileSync(join(kevinDir, "project.json"), body);
}

const REMOTE_CONFIG = `[core]
	repositoryformatversion = 0
[remote "origin"]
	url = https://github.com/team/shared.git
[branch "main"]
	remote = origin
`;

const DECLARED_ID = "0123456789abcdef";

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "kevin-repoidentity-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("computeRepoId", () => {
	it("hashes the domain-prefixed normalized remote", () => {
		expect(computeRepoId("github.com/acme/app")).toBe(
			fnv1a64("okf:repo:v1\u0000github.com/acme/app"),
		);
	});

	it("is a 16-char lowercase hex string", () => {
		expect(computeRepoId("github.com/acme/app")).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("resolve — three-source precedence", () => {
	it("resolves declared when both project.json and a remote exist", () => {
		writeConfig(root, REMOTE_CONFIG);
		writeProjectJson(root, JSON.stringify({ id: DECLARED_ID }));
		const id = resolve(root);
		expect(id.repoId).toBe(DECLARED_ID);
		expect(id.source).toBe("declared");
		expect(id.evidence).toBe(".kevin/project.json#id");
	});

	it("resolves remote after removing project.json", () => {
		writeConfig(root, REMOTE_CONFIG);
		writeProjectJson(root, JSON.stringify({ id: DECLARED_ID }));
		rmSync(join(root, ".kevin"), { recursive: true, force: true });
		const id = resolve(root);
		expect(id.source).toBe("remote");
		expect(id.evidence).toBe("remote:github.com/team/shared");
		expect(id.repoId).toBe(computeRepoId("github.com/team/shared"));
	});

	it("resolves path after removing .git", () => {
		writeConfig(root, REMOTE_CONFIG);
		rmSync(join(root, ".git"), { recursive: true, force: true });
		const id = resolve(root);
		expect(id.source).toBe("path");
		expect(id.evidence).toBe("cwd");
		expect(id.repoId).toBe(id.projectId);
		expect(id.repoId).toBe(fingerprint(root));
	});

	it("two directories at different paths with identical remotes share repoId but differ in projectId", () => {
		const other = mkdtempSync(join(tmpdir(), "kevin-repoidentity-"));
		try {
			writeConfig(root, REMOTE_CONFIG);
			writeConfig(other, REMOTE_CONFIG);
			const a = resolve(root);
			const b = resolve(other);
			expect(a.repoId).toBe(b.repoId);
			expect(a.projectId).not.toBe(b.projectId);
		} finally {
			rmSync(other, { recursive: true, force: true });
		}
	});

	it("resolve on a non-existent directory returns source path and does not throw", () => {
		const ghost = join(tmpdir(), "kevin-ghost-does-not-exist-xyz");
		expect(() => resolve(ghost)).not.toThrow();
		const id = resolve(ghost);
		expect(id.source).toBe("path");
		expect(id.repoId).toBe(fingerprint(ghost));
	});

	it("a project.json with a non-hex id falls through to the remote", () => {
		writeConfig(root, REMOTE_CONFIG);
		writeProjectJson(root, JSON.stringify({ id: "not-hex" }));
		const id = resolve(root);
		expect(id.source).toBe("remote");
		expect(id.repoId).toBe(computeRepoId("github.com/team/shared"));
	});

	it("a project.json with an uppercase-hex id falls through (ids are lowercase-only)", () => {
		writeConfig(root, REMOTE_CONFIG);
		writeProjectJson(root, JSON.stringify({ id: "0123456789ABCDEF" }));
		const id = resolve(root);
		expect(id.source).toBe("remote");
	});

	it("a malformed project.json falls through without throwing", () => {
		writeConfig(root, REMOTE_CONFIG);
		writeProjectJson(root, "{not json");
		expect(() => resolve(root)).not.toThrow();
		const id = resolve(root);
		expect(id.source).toBe("remote");
	});

	it("evidence never contains a credential or an absolute path", () => {
		writeConfig(
			root,
			`[remote "origin"]
	url = https://user:ghp_secret@github.com/team/shared.git
`,
		);
		const id = resolve(root);
		expect(id.source).toBe("remote");
		expect(id.evidence).not.toContain("ghp_secret");
		expect(id.evidence).not.toContain("user");
		expect(id.evidence).not.toContain(root);
		expect(id.evidence).toContain("github.com/team/shared");
	});

	it("an unreadable .git/config (directory in place of file) falls through to path", () => {
		const gitDir = join(root, ".git");
		mkdirSync(gitDir, { recursive: true });
		mkdirSync(join(gitDir, "config"), { recursive: true });
		const id = resolve(root);
		expect(id.source).toBe("path");
		expect(id.repoId).toBe(id.projectId);
	});
});
