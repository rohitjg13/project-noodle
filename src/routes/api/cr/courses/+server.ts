import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { crCourse } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { readJson, requireManager, str } from '$lib/server/api';
import { courseNames } from '$lib/server/timetable';

// GET /api/cr/courses — the signed-in CR's watched courses
export const GET: RequestHandler = async ({ locals }) => {
	const user = requireManager(locals);
	const courses = await db
		.select({ courseCode: crCourse.courseCode, courseName: crCourse.courseName })
		.from(crCourse)
		.where(eq(crCourse.userId, user.id))
		.orderBy(crCourse.courseCode);
	return json({ courses });
};

// POST /api/cr/courses — add one course by base code. Only codes that exist in the
// timetable are accepted, and the stored title is the sheet's, not the client's.
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireManager(locals);

	const code = str((await readJson(request)).courseCode, 64).toUpperCase();
	const courseName = courseNames.get(code);
	if (courseName === undefined) error(400, 'Unknown course code');

	// Adding a course you already track is still success
	await db
		.insert(crCourse)
		.values({ userId: user.id, courseCode: code, courseName })
		.onConflictDoNothing();

	return json({ course: { courseCode: code, courseName } });
};

// DELETE /api/cr/courses — remove one course by base code
export const DELETE: RequestHandler = async ({ locals, request }) => {
	const user = requireManager(locals);

	const code = str((await readJson(request)).courseCode, 64).toUpperCase();
	if (!code) error(400, 'courseCode required');

	await db.delete(crCourse).where(and(eq(crCourse.userId, user.id), eq(crCourse.courseCode, code)));
	return json({ success: true });
};
