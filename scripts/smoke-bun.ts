import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "@jmtrin/kevin-core";
import { Migrate } from "@jmtrin/kevin-core";
import { Store } from "@jmtrin/kevin-core";

const store = new Store({ path: ":memory:" });
const __dirname = dirname(fileURLToPath(import.meta.url));
const migDir = resolve(__dirname, "../packages/core/migrations");
await new Migrate(store, migDir).run();
const mem = new MemoryService(store);
const id = mem.save({ type: "error", content: "smoke test bun query lesson" });
console.log("saved id:", id);
const found = mem.query({ text: "smoke", full: true });
console.log("query rows:", found.length, "content0:", found[0]?.content);
store.close();
console.log("OK bun path");
