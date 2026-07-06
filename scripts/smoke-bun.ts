import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryService } from "../plugin/MemoryService.js";
import { Migrate } from "../plugin/Migrate.js";
import { Store } from "../plugin/Store.js";

const store = new Store({ path: ":memory:" });
const __dirname = dirname(fileURLToPath(import.meta.url));
const migDir = resolve(__dirname, "../migrations");
await new Migrate(store, migDir).run();
const mem = new MemoryService(store);
const id = mem.save({ type: "error", content: "smoke test bun query lesson" });
console.log("saved id:", id);
const found = mem.query({ text: "smoke" });
console.log("query rows:", found.length, "content0:", found[0]?.content);
store.close();
console.log("OK bun path");
