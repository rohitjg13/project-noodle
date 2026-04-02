import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scheduleBlock } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

// GET /api/cr/schedule — returns all overrides (keyed by courseCode+component globally)
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const blocks = await db.select().from(scheduleBlock);
	return json({ blocks });
};

// POST /api/cr/schedule — upsert a block override
// Body: { courseCode, component, batch, day, startTime, endTime, courseName, faculty, room }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = await request.json();
	const { courseCode, component, batch, day, startTime, endTime, courseName, faculty, room } = body;

	if (!courseCode || !batch || !day || !startTime || !endTime) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	// Key is courseCode+component only — batch-independent, syncs across all CRs
	const existing = await db
		.select({ id: scheduleBlock.id })
		.from(scheduleBlock)
		.where(
			and(
				eq(scheduleBlock.courseCode, courseCode),
				eq(scheduleBlock.component, component ?? '')
			)
		)
		.limit(1);

	if (existing.length > 0) {
		await db
			.update(scheduleBlock)
			.set({ day, startTime, endTime, updatedAt: new Date() })
			.where(eq(scheduleBlock.id, existing[0].id));
	} else {
		await db.insert(scheduleBlock).values({
			courseCode,
			courseName: courseName ?? courseCode,
			component: component ?? '',
			faculty: faculty ?? '',
			room: room ?? '',
			day,
			startTime,
			endTime,
			batch,
			createdBy: locals.user.id
		});
	}

	return json({ success: true });
};
