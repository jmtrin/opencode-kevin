import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSkill, validateSkillFile } from "@jmtrin/kevin-core";

const FIXT_INVALID = join(process.cwd(), "tests", "fixtures", "skills", "invalid");
const FIXT_VALID_MIN = join(process.cwd(), "tests", "fixtures", "skills", "valid-minimal.md");
const FIXT_VALID_FULL = join(process.cwd(), "tests", "fixtures", "skills", "valid-full.md");

describe("skills-validate K15-002", () => {
	it("rejects missing frontmatter", () => {
		const c = readFileSync(join(FIXT_INVALID, "missing-frontmatter.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("frontmatter"))).toBe(true);
	});
	it("rejects bad name uppercase", () => {
		const c = readFileSync(join(FIXT_INVALID, "bad-name-uppercase.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("name"))).toBe(true);
	});
	it("rejects bad name double dash", () => {
		const c = readFileSync(join(FIXT_INVALID, "bad-name-double-dash.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("--") || e.includes("name"))).toBe(true);
	});
	it("rejects bad name leading dash", () => {
		const c = readFileSync(join(FIXT_INVALID, "bad-name-leading-dash.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("name"))).toBe(true);
	});
	it("rejects bad name trailing dash", () => {
		const c = readFileSync(join(FIXT_INVALID, "bad-name-trailing-dash.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("name"))).toBe(true);
	});
	it("rejects name != dirname", () => {
		const c = readFileSync(join(FIXT_INVALID, "name-notequal-dirname.md"), "utf8");
		const r = validateSkill(c, "other-dir");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("directory"))).toBe(true);
	});
	it("rejects description empty", () => {
		const c = readFileSync(join(FIXT_INVALID, "description-empty.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("description"))).toBe(true);
	});
	it("rejects description >1024", () => {
		const c = readFileSync(join(FIXT_INVALID, "description-too-long.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("description"))).toBe(true);
	});
	it("rejects metadata non-string", () => {
		const c = readFileSync(join(FIXT_INVALID, "metadata-non-string.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("metadata"))).toBe(true);
	});
	it("rejects body missing", () => {
		const c = readFileSync(join(FIXT_INVALID, "body-missing.md"), "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("body"))).toBe(true);
	});
	it("accepts minimal conformant", () => {
		const c = readFileSync(FIXT_VALID_MIN, "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(true);
		expect(r.errors).toEqual([]);
	});
	it("accepts full metadata conformant", () => {
		const c = readFileSync(FIXT_VALID_FULL, "utf8");
		const r = validateSkill(c, "kevin-knowledge");
		expect(r.ok).toBe(true);
		expect(r.errors).toEqual([]);
	});
	it("warns on >500 line body", () => {
		const c = readFileSync(FIXT_VALID_MIN, "utf8");
		// append 501 lines body
		const longBody = c + "\n" + Array.from({ length: 501 }, (_, i) => `line ${i}`).join("\n");
		const r = validateSkill(longBody, "kevin-knowledge");
		expect(r.ok).toBe(true);
		expect(r.warnings.some((w) => w.includes("500"))).toBe(true);
	});
	it("validateSkillFile uses dirname from path", () => {
		const c = readFileSync(FIXT_VALID_MIN, "utf8");
		const r = validateSkillFile("some/dir/kevin-knowledge/SKILL.md", c);
		expect(r.ok).toBe(true);
		const r2 = validateSkillFile("some/dir/other/SKILL.md", c);
		expect(r2.ok).toBe(false);
	});
});
