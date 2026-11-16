import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { professorConstraint } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { readJson, requireManager, str } from '$lib/server/api';
import { isWeekday } from '$lib/timetable-parse';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const columns = {
	id: professorConstraint.id,
	professorName: professorConstraint.professorName,
	day: professorConstraint.day,
	startTime: professorConstraint.startTime,
	endTime: professorConstraint.endTime,
	allDay: professorConstraint.allDay,
	reason: professorConstraint.reason
};

export const GET: RequestHandler = async ({ locals }) => {
	requireManager(locals);
	const constraints = await db.select(columns).from(professorConstraint).orderBy(professorConstraint.id);
	return json({ constraints });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireManager(locals);

	const body = await readJson(request);
	const professorName = str(body.professorName, 120);
	const reason = str(body.reason, 300) || null;
	const allDay = body.allDay === true;
	if (!professorName) error(400, 'Professor name required');
	if (!isWeekday(body.day)) error(400, 'Invalid day');

	let startTime: string | null = null;
	let endTime: string | null = null;
	if (!allDay) {
		startTime = str(body.startTime, 5);
		endTime = str(body.endTime, 5);
		// Zero-padded 24h strings compare correctly as text
		if (!HHMM.test(startTime) || !HHMM.test(endTime) || startTime >= endTime) {
			error(400, 'Invalid time range');
		}
	}

	const [constraint] = await db
		.insert(professorConstraint)
		.values({ professorName, day: body.day, startTime, endTime, allDay, reason, createdBy: user.id })
		.returning(columns);

	return json({ constraint });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	requireManager(locals);

	const { id } = await readJson(request);
	if (typeof id !== 'number' || !Number.isInteger(id)) error(400, 'ID required');

	await db.delete(professorConstraint).where(eq(professorConstraint.id, id));
	return json({ success: true });
};
