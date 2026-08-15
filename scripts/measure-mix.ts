import { createRequire } from "node:module";

const dbPath = process.argv[2];
if (!dbPath) {
	console.error("Usage: npm run measure:mix -- <database-path>");
	process.exitCode = 2;
} else {
	try {
		const require = createRequire(import.meta.url);
		const Database = require("better-sqlite3") as new (
			path: string,
		) => {
			prepare(sql: string): { all(): unknown[]; get(): unknown };
			close(): void;
		};
		const db = new Database(dbPath);
		const hasTable = db
			.prepare(
				"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_conflicts'",
			)
			.get();
		if (!hasTable)
			throw new Error("database is pre-008: memory_conflicts is missing");
		const rows = db
			.prepare(
				"SELECT m.type, COUNT(*) AS n FROM kevin_injections i JOIN memories m ON m.id = i.memory_id GROUP BY m.type",
			)
			.all() as Array<{ type: string; n: number }>;
		const injectedByType: Record<string, number> = {};
		for (const row of rows) injectedByType[row.type] = row.n;
		const total = rows.reduce((sum, row) => sum + row.n, 0);
		const nonError = total - (injectedByType.error ?? 0);
		const precision = (where: string): number => {
			const row = db
				.prepare(
					`SELECT SUM(CASE WHEN i.outcome = 'effective' THEN 1 ELSE 0 END) AS e, SUM(CASE WHEN i.outcome = 'ineffective' THEN 1 ELSE 0 END) AS n FROM kevin_injections i JOIN memories m ON m.id = i.memory_id WHERE ${where}`,
				)
				.get() as { e: number | null; n: number | null };
			const denominator = (row.e ?? 0) + (row.n ?? 0);
			return denominator > 0 ? (row.e ?? 0) / denominator : 0;
		};
		const memoryCount = (
			db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }
		).n;
		const settled = (
			db
				.prepare(
					"SELECT COUNT(*) AS n FROM kevin_injections WHERE outcome IN ('effective','ineffective')",
				)
				.get() as { n: number }
		).n;
		const precisionError = precision("m.type = 'error'");
		const precisionNonError = precision("m.type <> 'error'");
		const mature = memoryCount >= 100 && settled >= 50;
		const nonErrorShare = total > 0 ? nonError / total : 0;
		const meets =
			mature && nonErrorShare >= 0.5 && precisionNonError > precisionError;
		console.log(
			JSON.stringify(
				{
					injected_by_type: injectedByType,
					injected_total: total,
					non_error_injected: nonError,
					non_error_share: nonErrorShare,
					precision_error: precisionError,
					precision_non_error: precisionNonError,
					meets_exit_criterion: meets,
					...(mature ? {} : { reason: "immature_db" }),
				},
				null,
				2,
			),
		);
		console.log(
			`VERDICT: ${meets ? "meets_exit_criterion" : "does_not_meet_exit_criterion"}`,
		);
		db.close();
		if (!meets) process.exitCode = 1;
	} catch (error) {
		console.error(
			`measure:mix failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
