import { redirect } from '@sveltejs/kit';
import { eq, and, ne, count, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { crAssignment, batch, crCourse, studentPreference, scheduleBlock, notification, professorConstraint } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');

	// Only what the page renders — the session row's timestamps and flags stay server-side
	const { id, name, email, role } = locals.user;
	const user = { id, name, email, role };
	const canManage = user.role === 'cr' || user.role === 'super_admin';

	// Everyone has the student view, CRs and admins included
	const preferenceQuery = db
		.select({
			batch: studentPreference.batch,
			minor: studentPreference.minor,
			uwePref1: studentPreference.uwePref1,
			uwePref2: studentPreference.uwePref2,
			uwePref3: studentPreference.uwePref3,
			locked: studentPreference.locked
		})
		.from(studentPreference)
		.where(eq(studentPreference.userId, user.id))
		.limit(1);

	if (!canManage) {
		const [preference] = await preferenceQuery;
		return { user, preference: preference ?? null, crBatches: [], myCourses: [], savedSchedule: [], constraints: [], notifications: [], watchCounts: [], globalTop5: [] };
	}

	const [[preference], batchResult, myCourses, scheduleResult, notifResult, watchCounts, constraints, top5] = await Promise.all([
		preferenceQuery,
		db
			.select({
				batch: { id: batch.id, name: batch.name }
			})
			.from(crAssignment)
			.innerJoin(batch, eq(crAssignment.batchId, batch.id))
			.where(eq(crAssignment.userId, user.id)),
		db
			.select({ courseCode: crCourse.courseCode, courseName: crCourse.courseName })
			.from(crCourse)
			.where(eq(crCourse.userId, user.id))
			.orderBy(crCourse.courseCode),
		db
			.select({
				courseCode: scheduleBlock.courseCode,
				component: scheduleBlock.component,
				originalDay: scheduleBlock.originalDay,
				day: scheduleBlock.day,
				startTime: scheduleBlock.startTime,
				endTime: scheduleBlock.endTime
			})
			.from(scheduleBlock),
		db
			.select({
				id: notification.id,
				fromUserName: notification.fromUserName,
				courseCode: notification.courseCode,
				message: notification.message,
				createdAt: notification.createdAt
			})
			.from(notification)
			.where(and(eq(notification.toUserId, user.id), eq(notification.dismissed, false)))
			.orderBy(notification.createdAt),
		// How many other CRs watch each course — drives the "heads up" modal before a move
		db
			.select({ code: crCourse.courseCode, count: count() })
			.from(crCourse)
			.where(ne(crCourse.userId, user.id))
			.groupBy(crCourse.courseCode),
		db
			.select({
				id: professorConstraint.id,
				professorName: professorConstraint.professorName,
				day: professorConstraint.day,
				startTime: professorConstraint.startTime,
				endTime: professorConstraint.endTime,
				allDay: professorConstraint.allDay,
				reason: professorConstraint.reason
			})
			.from(professorConstraint)
			.orderBy(professorConstraint.id),
		// The five most-wanted UWEs across ALL students (first choice ×3, second ×2, third ×1)
		// — moving one of these also raises the "heads up" modal
		db.execute<{ code: string; total: number }>(sql`
			SELECT upper(v.code) AS code, count(*)::int AS total
			FROM student_preference p
			CROSS JOIN LATERAL (VALUES (p.uwe_pref_1, 3), (p.uwe_pref_2, 2), (p.uwe_pref_3, 1)) AS v(code, weight)
			WHERE v.code IS NOT NULL AND v.code <> ''
			GROUP BY upper(v.code)
			ORDER BY sum(v.weight) DESC, upper(v.code)
			LIMIT 5`)
	]);

	return {
		user,
		preference: preference ?? null,
		crBatches: batchResult,
		myCourses,
		savedSchedule: scheduleResult,
		notifications: notifResult.map((n) => ({ ...n, createdAt: n.createdAt.getTime() })),
		constraints,
		watchCounts,
		globalTop5: [...top5].map((r) => ({ code: r.code, total: r.total }))
	};
};
