import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scheduleBlock } from '$lib/server/db/schema';
import { eq, and, isNull, or } from 'drizzle-orm';

// GET /api/cr/schedule — returns all overrides (keyed by courseCode+component+originalDay globally)
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const blocks = await db.select().from(scheduleBlock);
	return json({ blocks });
};

// POST /api/cr/schedule — upsert a block override
// Body: { courseCode, component, originalDay, batch, day, startTime, endTime, courseName, faculty, room }
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = await request.json();
	const { courseCode, component, originalDay, batch, day, startTime, endTime, courseName, faculty, room } = body;

	if (!courseCode || !batch || !day || !startTime || !endTime || !originalDay) {
		return json({ error: 'Missing required fields' }, { status: 400 });
	}

	// Key is courseCode+component+originalDay — each day-slot is independently overridable
	// Handle NULL vs empty string for component column
	const comp = component ?? '';
	const componentCondition = comp
		? eq(scheduleBlock.component, comp)
		: or(eq(scheduleBlock.component, ''), isNull(scheduleBlock.component));

	const origDayCondition = originalDay
		? eq(scheduleBlock.originalDay, originalDay)
		: or(eq(scheduleBlock.originalDay, ''), isNull(scheduleBlock.originalDay));

	const existing = await db
		.select({ id: scheduleBlock.id })
		.from(scheduleBlock)
		.where(and(eq(scheduleBlock.courseCode, courseCode), componentCondition, origDayCondition))
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
			component: comp,
			faculty: faculty ?? '',
			room: room ?? '',
			originalDay,
			day,
			startTime,
			endTime,
			batch,
			createdBy: locals.user.id
		});
	}

	return json({ success: true });
};

// DELETE /api/cr/schedule — clear all overrides (reset to XLSX originals)
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}
	await db.delete(scheduleBlock);
	return json({ success: true });
};
