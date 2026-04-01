import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scheduleBlock } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const blocks = await db.select().from(scheduleBlock);
	return json({ blocks });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const { id, day, startTime, endTime } = await request.json();
	if (!id || !day || !startTime || !endTime) return json({ error: 'Missing fields' }, { status: 400 });

	await db.update(scheduleBlock).set({ day, startTime, endTime }).where(eq(scheduleBlock.id, id));
	return json({ success: true });
};
