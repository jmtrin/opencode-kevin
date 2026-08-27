#!/usr/bin/env node
// v1.1.0 (K11-018) — extract CHANGELOG section for the current version
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

function parseArgs() {
	const v = process.argv[2];
	if (v) return v;
	try {
		const pkg = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
		);
		return pkg.version ?? "";
	} catch {
		return "";
	}
}

function extractSection(changelog, version) {
	const lines = changelog.split("\n");
	let start = -1;
	let end = lines.length;
	const headingRe = /^## \[/;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (headingRe.test(line) && line.includes(`[${version}]`)) {
			start = i;
			continue;
		}
		if (start !== -1 && headingRe.test(line)) {
			end = i;
			break;
		}
	}
	if (start === -1) return null;
	// Return from heading line to before next heading
	return `${lines.slice(start, end).join("\n").trim()}\n`;
}

const version = parseArgs();
if (!version) {
	console.error("Usage: node scripts/release-notes.mjs [version]");
	process.exit(1);
}
let changelog;
try {
	changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
} catch (e) {
	console.error(`Cannot read CHANGELOG.md: ${e.message}`);
	process.exit(1);
}
const section = extractSection(changelog, version);
if (!section) {
	console.error(`No CHANGELOG section found for version ${version}`);
	process.exit(1);
}
process.stdout.write(section);
