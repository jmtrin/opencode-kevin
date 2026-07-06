import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = join(root, "migrations");
const dest = join(root, "dist", "migrations");

await mkdir(dest, { recursive: true });
const entries = await readdir(src, { withFileTypes: true });
for (const entry of entries) {
	if (entry.isFile() && entry.name.endsWith(".sql")) {
		await cp(join(src, entry.name), join(dest, entry.name));
	}
}
