// K15-002 — spec-subset validator (plan §4.3, D15-07)
// Naive YAML subset: `key: value` + one-level map for metadata + folded scalars (>-, >, |)
// Returns {ok, errors[], warnings[]} — hard rules -> errors, soft -> warnings.

export interface SkillValidateResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
}

const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LEN = 64;
const MIN_DESC = 1;
const MAX_DESC = 1024;
const MAX_BODY_LINES = 500;

export function validateSkill(content: string, dirname?: string): SkillValidateResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const normalized = content.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");

	// frontmatter must start with ---
	if (lines.length === 0 || lines[0].trim() !== "---") {
		errors.push("frontmatter: missing opening '---'");
		return { ok: false, errors, warnings };
	}
	// find closing ---
	let closeIdx = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			closeIdx = i;
			break;
		}
	}
	if (closeIdx === -1) {
		errors.push("frontmatter: missing closing '---'");
		return { ok: false, errors, warnings };
	}

	const fmLines = lines.slice(1, closeIdx);
	const bodyLines = lines.slice(closeIdx + 1);
	const body = bodyLines.join("\n");
	const bodyTrimmed = body.trim();

	// parse frontmatter naive
	const fm: Record<string, unknown> = {};
	let currentParent: string | null = null;
	let foldedKey: string | null = null;
	let foldedBuffer: string[] = [];
	// helper to flush folded
	function flushFolded() {
		if (foldedKey !== null) {
			const joined = foldedBuffer.join(" ").trim();
			if (currentParent === "metadata" && foldedKey) {
				// inside metadata? folded not expected, but handle
				const meta = fm["metadata"] as Record<string, string>;
				meta[foldedKey] = joined;
			} else if (foldedKey) {
				fm[foldedKey] = joined;
			}
			foldedKey = null;
			foldedBuffer = [];
		}
	}

	for (let idx = 0; idx < fmLines.length; idx++) {
		const raw = fmLines[idx];
		// if we are in folded collection, indented lines are continuation
		if (foldedKey !== null) {
			if (/^\s+/.test(raw) && raw.trim() !== "") {
				foldedBuffer.push(raw.trim());
				continue;
			} else {
				// end of folded block
				flushFolded();
				// fall through to parse current line normally
			}
		}
		if (raw.trim() === "") continue;
		// indented means metadata child or continuation already handled
		const indentMatch = raw.match(/^(\s+)(.*)$/);
		if (indentMatch && indentMatch[1].length >= 2) {
			const inner = indentMatch[2];
			if (currentParent !== "metadata") {
				errors.push(`frontmatter: unexpected indent at line ${idx + 2}`);
				continue;
			}
			const m = inner.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
			if (!m) {
				errors.push(`frontmatter: invalid metadata line '${raw.trim()}'`);
				continue;
			}
			const k = m[1];
			const v = m[2].trim();
			// strip surrounding quotes if present for storage but keep raw for type check
			const stored = stripQuotes(v);
			// detect folded for metadata? not needed
			const meta = fm["metadata"] as Record<string, string>;
			// keep raw detection for non-string check: if v is unquoted number/boolean
			// we still store but flag later; store raw trimmed
			meta[k] = stored;
			// also keep raw for validation via separate map
			// we store raw in a hidden map
			if (!(fm as Record<string, unknown>).__metaRaw) (fm as Record<string, unknown>).__metaRaw = {};
			((fm as Record<string, unknown>).__metaRaw as Record<string, string>)[k] = v;
			continue;
		}
		// top-level key: value
		const m = raw.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!m) {
			errors.push(`frontmatter: invalid line '${raw.trim()}'`);
			continue;
		}
		const key = m[1];
		const val = m[2].trim();
		// handle folded scalar indicators
		if (val === ">-" || val === ">" || val === "|" || val === "|-") {
			foldedKey = key;
			foldedBuffer = [];
			// initialize parent tracking if key is metadata (but folded metadata not expected)
			if (key === "metadata") {
				// metadata with folded? treat as empty then parent
				fm[key] = {};
				currentParent = "metadata";
			} else {
				currentParent = null;
				fm[key] = ""; // placeholder, will be filled on flush
			}
			continue;
		}
		if (key === "metadata") {
			// metadata: may be empty (map follows) or inline? We support only map form.
			const normalizedVal = val.trim();
			const compactVal = normalizedVal.replace(/\s/g, "");
			if (normalizedVal === "" || normalizedVal === "{}" || compactVal === "{}") {
				fm[key] = {};
				currentParent = "metadata";
				// init raw map
				(fm as Record<string, unknown>).__metaRaw = {};
			} else {
				errors.push("frontmatter: metadata must be a map");
				fm[key] = val;
				currentParent = null;
			}
			continue;
		}
		// normal key
		currentParent = null;
		flushFolded();
		fm[key] = stripQuotes(val);
		// store raw for description length? raw stripped is fine
	}
	flushFolded();

	// --- validation rules ---

	// name
	const name = fm["name"] as string | undefined;
	if (name === undefined || (typeof name === "string" && name.trim() === "")) {
		errors.push("name: missing");
	} else if (typeof name !== "string") {
		errors.push("name: must be a string");
	} else {
		const n = name.trim();
		if (n.length < 1 || n.length > MAX_NAME_LEN) {
			errors.push(`name: length must be 1-${MAX_NAME_LEN} (got ${n.length})`);
		}
		if (!NAME_RE.test(n)) {
			errors.push(`name: invalid format '${n}' (must match ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$)`);
		}
		if (n.includes("--")) {
			errors.push("name: must not contain '--'");
		}
		if (dirname !== undefined && n !== dirname) {
			errors.push(`name: must equal directory name '${dirname}' (got '${n}')`);
		}
	}

	// description
	const desc = fm["description"] as string | undefined;
	if (desc === undefined || (typeof desc === "string" && desc.trim() === "")) {
		errors.push("description: missing or empty");
	} else if (typeof desc !== "string") {
		errors.push("description: must be a string");
	} else {
		const d = desc.trim();
		if (d.length < MIN_DESC || d.length > MAX_DESC) {
			errors.push(`description: length must be 1-${MAX_DESC} (got ${d.length})`);
		}
	}

	// metadata values all strings - check raw entries for non-string literals
	if (fm["metadata"] !== undefined) {
		const meta = fm["metadata"] as Record<string, unknown>;
		const rawMap = ((fm as Record<string, unknown>).__metaRaw as Record<string, string> | undefined) ?? {};
		if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
			errors.push("metadata: must be a map of strings");
		} else {
			for (const [k, v] of Object.entries(meta)) {
				if (typeof v !== "string") {
					errors.push(`metadata: value for '${k}' must be a string`);
				} else {
					const raw = rawMap[k] ?? v;
					// raw is the stored trimmed value without quotes as appears after colon
					// If raw is numeric / boolean / null without quotes, treat as non-string
					if (/^-?\d+(\.\d+)?$/.test(raw) || raw === "true" || raw === "false" || raw === "null") {
						errors.push(`metadata: value for '${k}' must be a string (got '${raw}')`);
					}
				}
			}
		}
	}

	// body present
	if (bodyTrimmed === "") {
		errors.push("body: missing");
	} else {
		const bodyLineCount = bodyTrimmed.split("\n").length;
		if (bodyLineCount > MAX_BODY_LINES) {
			warnings.push(`body: exceeds ${MAX_BODY_LINES} lines (got ${bodyLineCount})`);
		}
	}

	const ok = errors.length === 0;
	return { ok, errors, warnings };
}

function stripQuotes(s: string): string {
	const t = s.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1);
	}
	return t;
}

// helper for file-based validation (reads file and passes dirname)
export function validateSkillFile(filePath: string, content: string): SkillValidateResult {
	const parts = filePath.replace(/\\/g, "/").split("/");
	// dirname is parent dir name: .../<dirname>/SKILL.md
	const dir = parts.length >= 2 ? parts[parts.length - 2] : "";
	return validateSkill(content, dir);
}
