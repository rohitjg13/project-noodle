import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { studentPreference, crAssignment, batch } from '$lib/server/db/schema';
import { eq, or, ilike } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const { locked } = await request.json();

	if (locals.user.role === 'super_admin') {
		// Super admin locks everyone
		await db.update(studentPreference).set({ locked: !!locked });
	} else {
		// CR only locks students in their assigned batches
		const assignments = await db
			.select({ batchName: batch.name })
			.from(crAssignment)
			.innerJoin(batch, eq(crAssignment.batchId, batch.id))
			.where(eq(crAssignment.userId, locals.user.id));

		const batchNames = assignments.map((a) => a.batchName);
		if (batchNames.length > 0) {
			await db
				.update(studentPreference)
				.set({ locked: !!locked })
				.where(or(...batchNames.map((name) => ilike(studentPreference.batch, `%${name}%`))));
		}
	}

	return json({ success: true, locked: !!locked });
};
