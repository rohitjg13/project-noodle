import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { studentPreference } from '$lib/server/db/schema';
import { managedBatches, prefInBatches, readJson, requireManager } from '$lib/server/api';

// POST /api/student/preferences/lock — { locked } for every student in the caller's
// batches (admins: every student)
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireManager(locals);
	const locked = (await readJson(request)).locked === true;

	if (user.role === 'super_admin') {
		await db.update(studentPreference).set({ locked });
	} else {
		const batches = await managedBatches(user.id);
		if (batches.size > 0) {
			await db.update(studentPreference).set({ locked }).where(prefInBatches(batches));
		}
	}

	return json({ success: true, locked });
};
