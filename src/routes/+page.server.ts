import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { crAssignment, batch, studentPreference, scheduleBlock } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');

	const user = locals.user;

	// Load student preference
	const prefs = await db
		.select()
		.from(studentPreference)
		.where(eq(studentPreference.userId, user.id))
		.limit(1);

	// Load CR batches + schedule overrides if applicable
	let crBatches: { id: string; assignedAt: Date; batch: { id: string; name: string; description: string | null } }[] = [];
	let savedSchedule: { courseCode: string; component: string | null; originalDay: string | null; day: string; startTime: string; endTime: string }[] = [];

	if (user.role === 'cr' || user.role === 'super_admin') {
		const [batchResult, scheduleResult] = await Promise.all([
			db
				.select({
					id: crAssignment.id,
					assignedAt: crAssignment.assignedAt,
					batch: { id: batch.id, name: batch.name, description: batch.description }
				})
				.from(crAssignment)
				.innerJoin(batch, eq(crAssignment.batchId, batch.id))
				.where(eq(crAssignment.userId, user.id)),
			db
				.select({
					courseCode: scheduleBlock.courseCode,
					component: scheduleBlock.component,
					originalDay: scheduleBlock.originalDay,
					day: scheduleBlock.day,
					startTime: scheduleBlock.startTime,
					endTime: scheduleBlock.endTime
				})
				.from(scheduleBlock)
		]);
		crBatches = batchResult;
		savedSchedule = scheduleResult;
	}

	return {
		user,
		preference: prefs[0] ?? null,
		crBatches,
		crBatch: crBatches[0]?.batch ?? null,
		savedSchedule
	};
};
