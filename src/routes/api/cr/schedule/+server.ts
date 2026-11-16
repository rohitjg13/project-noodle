import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scheduleBlock, professorConstraint } from '$lib/server/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { managedBatches, readJson, requireManager, revalidatedJson, str } from '$lib/server/api';
import { professorsOf, slotsByKey } from '$lib/server/timetable';
import { isWeekday } from '$lib/timetable-parse';
import { minutesToTime, timeToMinutes, type Course } from '$lib/types';

type Manager = ReturnType<typeof requireManager>;

const CLOCK = /^(1[0-2]|0?[1-9]):[0-5]\d (AM|PM)$/;

const slotKey = (b: { courseCode: string; component: string; originalDay: string }) =>
	`${b.courseCode}|${b.component}|${b.originalDay}`;

const sameSlot = (slot: Course, originalDay: string) =>
	and(
		eq(scheduleBlock.courseCode, slot.courseCode),
		eq(scheduleBlock.component, slot.component ?? ''),
		eq(scheduleBlock.originalDay, originalDay)
	);

/** The real timetable slot a request names, or a 400 — clients can't invent classes */
function slotFrom(body: Record<string, unknown>): { slot: Course; originalDay: string } {
	const originalDay = str(body.originalDay, 16);
	const slot = slotsByKey.get(
		slotKey({ courseCode: str(body.courseCode, 64), component: str(body.component, 16), originalDay })
	);
	if (!slot) error(400, 'Unknown timetable slot');
	return { slot, originalDay };
}

/** A CR may only move classes of the batches they represent; admins may move any */
const mayMove = (user: Manager, batches: Set<string>, slot: Course) =>
	user.role === 'super_admin' || slot.batches.some((b) => batches.has(b));

/**
 * Tell the other CRs a class moved: everyone who co-manages one of its batches, everyone
 * watching the course, and every CR with a student who ranked it as a UWE — except the
 * mover, and except anyone who still has an unread notice about the same course. One
 * statement, so it can't half-apply or double up.
 */
async function notifyMove(user: Manager, slot: Course) {
	const code = slot.base;
	// why: 1 = it's in their batch's timetable, 2 = on their watch list, 3 = their students want it
	const coManagers = slot.batches.length
		? sql`SELECT a.user_id, 1 AS why FROM cr_assignment a
				JOIN batch b ON b.id = a.batch_id
				WHERE upper(b.name) IN ${slot.batches}
			UNION ALL `
		: sql``;

	await db.execute(sql`
		INSERT INTO notification (id, to_user_id, from_user_name, course_code, message)
		SELECT gen_random_uuid()::text, t.user_id, ${user.name}, ${code},
			${code + ' was moved in the timetable by ' + user.name} ||
			CASE t.why WHEN 1 THEN ${" — this class is in your batch's timetable"}
				WHEN 2 THEN ${' — this course is on your watch list'}
				ELSE ${" — this course is in your batch's UWE demand"} END
		FROM (
			SELECT x.user_id, min(x.why) AS why FROM (
				${coManagers}SELECT w.user_id, 2 AS why FROM cr_course w WHERE w.course_code = ${code}
				UNION ALL
				SELECT a.user_id, 3 AS why FROM cr_assignment a
					JOIN batch b ON b.id = a.batch_id
					WHERE EXISTS (
						SELECT 1 FROM student_preference p
						WHERE ${code} IN (upper(p.uwe_pref_1), upper(p.uwe_pref_2), upper(p.uwe_pref_3))
							AND upper(b.name) = ANY (string_to_array(upper(replace(p.batch, ' ', '')), ','))
					)
			) x
			WHERE x.user_id <> ${user.id}
			GROUP BY x.user_id
		) t
		WHERE NOT EXISTS (
			SELECT 1 FROM notification n
			WHERE n.to_user_id = t.user_id AND n.course_code = ${code} AND n.dismissed = false
		)`);
}

// GET /api/cr/schedule — every saved move. Polled every few seconds by each open grid, so
// it sends only the columns the grid reads and answers 304 while nothing has changed.
export const GET: RequestHandler = async ({ locals, request }) => {
	requireManager(locals);
	const blocks = await db
		.select({
			courseCode: scheduleBlock.courseCode,
			component: scheduleBlock.component,
			originalDay: scheduleBlock.originalDay,
			day: scheduleBlock.day,
			startTime: scheduleBlock.startTime,
			endTime: scheduleBlock.endTime
		})
		.from(scheduleBlock)
		.orderBy(scheduleBlock.id);
	return revalidatedJson(request, JSON.stringify({ blocks }));
};

// POST /api/cr/schedule — move one weekly slot.
// Body: { courseCode, component, originalDay, day, startTime }
// Only the slot's identity and its new start are taken from the client. The class's
// length, title, room and batch all come from the timetable itself.
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireManager(locals);
	const body = await readJson(request);
	const { slot, originalDay } = slotFrom(body);

	const day = body.day;
	const startTime = str(body.startTime, 8).toUpperCase();
	if (!isWeekday(day) || !CLOCK.test(startTime)) error(400, 'Invalid day or start time');
	const startMin = timeToMinutes(startTime);
	const endMin = startMin + (slot.endMin - slot.startMin);
	if (endMin >= 24 * 60) error(400, 'Class would run past midnight');

	const [batches, constraints] = await Promise.all([
		user.role === 'super_admin' ? new Set<string>() : managedBatches(user.id),
		db
			.select({
				professorName: professorConstraint.professorName,
				startTime: professorConstraint.startTime,
				endTime: professorConstraint.endTime,
				allDay: professorConstraint.allDay
			})
			.from(professorConstraint)
			.where(eq(professorConstraint.day, day))
	]);
	if (!mayMove(user, batches, slot)) error(403, "That class isn't in one of your batches");

	// The grid refuses these drops too; this is the check that can't be bypassed
	const professors = professorsOf(slot);
	const blocked = constraints.find(
		(c) =>
			professors.includes(c.professorName.toUpperCase()) &&
			(c.allDay ||
				(c.startTime !== null &&
					c.endTime !== null &&
					startMin < timeToMinutes(c.endTime) &&
					timeToMinutes(c.startTime) < endMin))
	);
	if (blocked) error(409, `Prof. ${blocked.professorName} is unavailable then`);

	const position = { day, startTime: minutesToTime(startMin), endTime: minutesToTime(endMin) };
	await db
		.insert(scheduleBlock)
		.values({
			courseCode: slot.courseCode,
			courseName: slot.courseName || slot.courseCode,
			component: slot.component ?? '',
			faculty: slot.faculty,
			room: slot.room,
			originalDay,
			batch: slot.major,
			createdBy: user.id,
			...position
		})
		.onConflictDoUpdate({
			target: [scheduleBlock.courseCode, scheduleBlock.component, scheduleBlock.originalDay],
			set: { ...position, updatedAt: new Date() }
		});
	await notifyMove(user, slot);

	return json({ success: true, position });
};

// DELETE /api/cr/schedule
//   { courseCode, component, originalDay } — put that one slot back where the sheet has it
//   { all: true } — reset every move the caller is allowed to make (admins: everything)
// Anything else is a 400: an empty or mangled body must never read as "wipe it all".
export const DELETE: RequestHandler = async ({ locals, request }) => {
	const user = requireManager(locals);
	const body = await readJson(request);

	if (body.all === true) {
		if (user.role === 'super_admin') {
			await db.delete(scheduleBlock);
			return json({ success: true });
		}
		const [batches, saved] = await Promise.all([
			managedBatches(user.id),
			db
				.select({
					id: scheduleBlock.id,
					courseCode: scheduleBlock.courseCode,
					component: scheduleBlock.component,
					originalDay: scheduleBlock.originalDay
				})
				.from(scheduleBlock)
		]);
		const mine = saved.filter((b) => {
			const slot = slotsByKey.get(slotKey(b));
			return slot && mayMove(user, batches, slot);
		});
		if (mine.length) {
			await db.delete(scheduleBlock).where(inArray(scheduleBlock.id, mine.map((b) => b.id)));
		}
		return json({ success: true });
	}

	const { slot, originalDay } = slotFrom(body);
	if (!mayMove(user, user.role === 'super_admin' ? new Set() : await managedBatches(user.id), slot)) {
		error(403, "That class isn't in one of your batches");
	}
	const removed = await db
		.delete(scheduleBlock)
		.where(sameSlot(slot, originalDay))
		.returning({ id: scheduleBlock.id });
	if (removed.length) await notifyMove(user, slot);

	return json({ success: true });
};
