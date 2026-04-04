import { redirect } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { crAssignment, batch, studentPreference, scheduleBlock, notification } from '$lib/server/db/schema';
import { calculatePriorityScore } from '$lib/types';
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

	let notifications: { id: string; fromUserName: string; courseCode: string; message: string; createdAt: number }[] = [];

	let globalTop5: { code: string; total: number }[] = [];

	if (user.role === 'cr' || user.role === 'super_admin') {
		// Compute global top-5 UWE demand across ALL students (for warning modal)
		const allPrefsForWarn = await db.select({ uwePref1: studentPreference.uwePref1, uwePref2: studentPreference.uwePref2, uwePref3: studentPreference.uwePref3 }).from(studentPreference);
		const warnMap = new Map<string, { p1: number; p2: number; p3: number }>();
		for (const p of allPrefsForWarn) {
			for (const [code, rank] of [[p.uwePref1, 1], [p.uwePref2, 2], [p.uwePref3, 3]] as [string | null, number][]) {
				if (!code) continue;
				const e = warnMap.get(code) ?? { p1: 0, p2: 0, p3: 0 };
				if (rank === 1) e.p1++; else if (rank === 2) e.p2++; else e.p3++;
				warnMap.set(code, e);
			}
		}
		globalTop5 = [...warnMap.entries()]
			.sort((a, b) => calculatePriorityScore(b[1].p1, b[1].p2, b[1].p3) - calculatePriorityScore(a[1].p1, a[1].p2, a[1].p3))
			.slice(0, 5)
			.map(([code, counts]) => ({ code, total: counts.p1 + counts.p2 + counts.p3 }));

		const [batchResult, scheduleResult, notifResult] = await Promise.all([
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
				.orderBy(notification.createdAt)
		]);
		crBatches = batchResult;
		savedSchedule = scheduleResult;
		notifications = notifResult.map((n) => ({ ...n, createdAt: n.createdAt.getTime() }));
	}

	return {
		user,
		preference: prefs[0] ?? null,
		crBatches,
		crBatch: crBatches[0]?.batch ?? null,
		savedSchedule,
		notifications,
		globalTop5
	};
};
