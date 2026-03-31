import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { crAssignment, batch } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}

	const user = locals.user;

	if (user.role === 'cr') {
		const assignments = await db
			.select({
				id: crAssignment.id,
				assignedAt: crAssignment.assignedAt,
				batch: {
					id: batch.id,
					name: batch.name,
					description: batch.description
				}
			})
			.from(crAssignment)
			.innerJoin(batch, eq(crAssignment.batchId, batch.id))
			.where(eq(crAssignment.userId, user.id));

		return { user, crBatches: assignments, crBatch: assignments[0]?.batch ?? null };
	}

	return { user, crBatches: [], crBatch: null };
};
