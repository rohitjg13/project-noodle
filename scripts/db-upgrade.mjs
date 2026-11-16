// One-off, idempotent upgrade for databases created before the unique indexes existed.
// Run with `npm run db:upgrade` BEFORE deploying the code that relies on them.
//
// `drizzle-kit push` can't do this on its own: it refuses to add a unique index while
// duplicate rows exist (or offers to truncate the table). This script folds the
// duplicates together first, keeping the newest row, then creates exactly the indexes the
// schema declares — so a later `npm run db:push` finds nothing left to change.
import postgres from 'postgres';

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

try {
	await sql.begin(async (tx) => {
		// --- schedule_block: one saved position per weekly slot ---
		await tx`UPDATE schedule_block SET component = '' WHERE component IS NULL`;
		await tx`UPDATE schedule_block SET original_day = day WHERE original_day IS NULL OR original_day = ''`;
		const moves = await tx`
			DELETE FROM schedule_block a USING schedule_block b
			WHERE a.course_code = b.course_code AND a.component = b.component
				AND a.original_day = b.original_day
				AND (a.updated_at, a.id) < (b.updated_at, b.id)`;
		await tx`ALTER TABLE schedule_block ALTER COLUMN component SET DEFAULT ''`;
		await tx`ALTER TABLE schedule_block ALTER COLUMN component SET NOT NULL`;
		await tx`ALTER TABLE schedule_block ALTER COLUMN original_day SET NOT NULL`;
		await tx`CREATE UNIQUE INDEX IF NOT EXISTS schedule_block_slot_uniq
			ON schedule_block (course_code, component, original_day)`;

		// --- cr_assignment: one row per (CR, batch) ---
		const grants = await tx`
			DELETE FROM cr_assignment a USING cr_assignment b
			WHERE a.user_id = b.user_id AND a.batch_id = b.batch_id AND a.id > b.id`;
		await tx`CREATE UNIQUE INDEX IF NOT EXISTS cr_assignment_user_batch_uniq
			ON cr_assignment (user_id, batch_id)`;
		// Superseded by the unique index above, which leads with user_id
		await tx`DROP INDEX IF EXISTS "cr_assignment_userId_idx"`;

		// --- student_preference: one row per student ---
		const prefs = await tx`
			DELETE FROM student_preference a USING student_preference b
			WHERE a.user_id = b.user_id AND (a.updated_at, a.id) < (b.updated_at, b.id)`;
		await tx`CREATE UNIQUE INDEX IF NOT EXISTS student_preference_user_uniq
			ON student_preference (user_id)`;
		await tx`DROP INDEX IF EXISTS "pref_userId_idx"`;

		console.log(
			`upgrade complete — removed ${moves.count} duplicate move(s), ${grants.count} duplicate CR grant(s), ${prefs.count} duplicate preference row(s)`
		);
	});
} finally {
	await sql.end();
}
