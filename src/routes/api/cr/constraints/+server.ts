import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { professorConstraint } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const constraints = await db.select().from(professorConstraint);
	return json({ constraints });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const { professorName, day, startTime, endTime, allDay, reason } = await request.json();
	if (!professorName || !day) return json({ error: 'Professor name and day required' }, { status: 400 });

	const [inserted] = await db.insert(professorConstraint).values({
		professorName, day,
		startTime: allDay ? null : startTime,
		endTime: allDay ? null : endTime,
		allDay: allDay ?? false,
		reason,
		createdBy: locals.user.id
	}).returning();

	return json({ constraint: inserted });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const { id } = await request.json();
	if (!id) return json({ error: 'ID required' }, { status: 400 });
	await db.delete(professorConstraint).where(eq(professorConstraint.id, id));
	return json({ success: true });
};
