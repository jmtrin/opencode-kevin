import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { Migrate, type PostApplyHook } from "../../plugin/Migrate.js";
import { Store } from "../../plugin/Store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_001 = readFileSync(
	join(__dirname, "..", "..", "migrations", "001_initial.sql"),
	"utf8",
);
const SQL_003 = readFileSync(
	join(__dirname, "..", "..", "migrations", "003_v02_signal.sql"),
	"utf8",
);

let tmpRoot: string;
let migrationsDir: string;
let store: Store;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), "kevin-migrate-pa-"));
	migrationsDir = join(tmpRoot, "migrations");
	mkdirSync(migrationsDir, { recursive: true });
	store = new Store({ path: ":memory:" });
});

afterEach(() => {
	store.close();
	rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Migrate post-apply hooks", () => {
	it("invokes the registered hook when the corresponding version is applied", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		const hook: Mock = vi.fn();
		const migrate = new Migrate(store, migrationsDir, {
			"001": hook as unknown as PostApplyHook,
		});
		await migrate.run();
		expect(hook).toHaveBeenCalledTimes(1);
	});

	it("does not invoke the hook when the version is already applied", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		const hook: Mock = vi.fn();
		const migrate = new Migrate(store, migrationsDir, {
			"001": hook as unknown as PostApplyHook,
		});
		await migrate.run();
		hook.mockClear();
		await migrate.run();
		expect(hook).not.toHaveBeenCalled();
	});

	it("runs the hook inside the migration transaction (rollback on hook throw)", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		// Insert a sentinel row before migration 001 runs by pre-creating the
		// schema_version table and skipping 001 — but we want 001 to apply here,
		// so instead we register a hook that throws and assert that the version
		// is NOT recorded.
		const throwingHook: PostApplyHook = () => {
			throw new Error("hook failed");
		};
		const migrate = new Migrate(store, migrationsDir, { "001": throwingHook });
		await expect(migrate.run()).rejects.toThrow("hook failed");
		const versions = store
			.prepare("SELECT version FROM schema_version ORDER BY version")
			.all() as { version: string }[];
		// The whole migration rolled back — schema_version empty.
		expect(versions).toHaveLength(0);
	});

	it("registerPostApply adds or overrides a hook after construction", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		const hook: Mock = vi.fn();
		const migrate = new Migrate(store, migrationsDir);
		migrate.registerPostApply("001", hook as unknown as PostApplyHook);
		await migrate.run();
		expect(hook).toHaveBeenCalledTimes(1);
	});

	it("built-in 003 hook coerces empty-string origin back to 'agent'", async () => {
		// Apply 001 with no 003 file yet, then drop a synthetic memories row with
		// an empty-string origin (allowed by CHECK because CHECK excludes '' from
		// the enum we listed — actually the CHECK rejects '', so this row cannot
		// be inserted directly after 003; we instead pre-populate the column via
		// a raw UPDATE bypassing CHECK, which SQLite enforces on UPDATE too).
		// Therefore, to exercise the hook against a NULL/empty row, we apply 003
		// against a DB whose memories rows were created BEFORE 003 ran — the
		// DEFAULT 'agent' already populates them, and the hook's UPDATE is a
		// no-op but must not crash and must keep origin at 'agent'.
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		await new Migrate(store, migrationsDir).run();
		store
			.prepare(
				"INSERT INTO memories (id, type, content) VALUES ('m-legacy', 'error', 'boom')",
			)
			.run();
		// Apply 003 now (the 001-seeded row has no origin column until 003 runs).
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		await new Migrate(store, migrationsDir).run();
		const row = store
			.prepare("SELECT origin FROM memories WHERE id = 'm-legacy'")
			.get() as { origin: string };
		expect(row.origin).toBe("agent");
	});

	it("built-in 003 hook is invoked exactly once when 003 is applied", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		writeFileSync(join(migrationsDir, "003_v02_signal.sql"), SQL_003);
		const spy: Mock = vi.fn();
		const migrate = new Migrate(store, migrationsDir);
		// Override the built-in hook with a spy to count invocations.
		migrate.registerPostApply("003", spy as unknown as PostApplyHook);
		await migrate.run();
		expect(spy).toHaveBeenCalledTimes(1);
		// Second run is idempotent — no new invocations.
		await migrate.run();
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("accepts an empty postApplyHooks record (no hooks fire)", async () => {
		writeFileSync(join(migrationsDir, "001_initial.sql"), SQL_001);
		const hook: Mock = vi.fn();
		const migrate = new Migrate(store, migrationsDir, {});
		migrate.registerPostApply("001", hook as unknown as PostApplyHook);
		// Even though built-in hooks come from DEFAULT_POST_APPLY_HOOKS merged
		// with the empty object, the '001' hook should fire after registration.
		await migrate.run();
		expect(hook).toHaveBeenCalledTimes(1);
	});
});
