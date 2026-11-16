import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { studentPreference } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { readJson, requireUser, str } from '$lib/server/api';
import { uweCodes } from '$lib/server/timetable';

const BATCH = /^[A-Z0-9-]{1,24}$/;

export const GET: RequestHandler = async ({ locals }) => {
	const user = requireUser(locals);
	const [preference] = await db
		.select()
		.from(studentPreference)
		.where(eq(studentPreference.userId, user.id))
		.limit(1);
	return json({ preference: preference ?? null });
};

// POST /api/student/preferences — save the caller's batch, minor and ranked UWEs.
// Body: { batch: "ECE21,ECE2YR", minor, uwePref1, uwePref2, uwePref3 }
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await readJson(request);

	const batches = [...new Set(str(body.batch, 120).toUpperCase().split(',').map((b) => b.trim()).filter(Boolean))];
	if (batches.length < 1 || batches.length > 4 || !batches.every((b) => BATCH.test(b))) {
		error(400, 'Enter between one and four batch codes');
	}

	// Only courses the sheet marks as open-as-UWE can be ranked, each at most once
	const uwes = [body.uwePref1, body.uwePref2, body.uwePref3].map((v) => str(v, 64).toUpperCase() || null);
	const chosen = uwes.filter((c): c is string => c !== null);
	if (chosen.some((c) => !uweCodes.has(c))) error(400, 'Unknown UWE course');
	if (new Set(chosen).size !== chosen.length) error(400, 'Duplicate UWE preferences not allowed');

	const prefs = {
		batch: batches.join(','),
		minor: str(body.minor, 200) || null,
		uwePref1: uwes[0],
		uwePref2: uwes[1],
		uwePref3: uwes[2]
	};

	// One upsert; a locked row matches the conflict but fails setWhere, so nothing comes back
	const saved = await db
		.insert(studentPreference)
		.values({ userId: user.id, ...prefs })
		.onConflictDoUpdate({
			target: studentPreference.userId,
			set: { ...prefs, updatedAt: new Date() },
			setWhere: eq(studentPreference.locked, false)
		})
		.returning({ id: studentPreference.id });
	if (saved.length === 0) error(403, 'Preferences are locked');

	return json({ success: true });
};
