import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { notification, crAssignment, batch, studentPreference } from '$lib/server/db/schema';
import { eq, or, ilike, ne } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const { courseCode } = await request.json();
	if (!courseCode) return json({ error: 'Missing courseCode' }, { status: 400 });

	// Find students who have this course in any of their UWE preferences
	const interestedStudents = await db
		.select({ batch: studentPreference.batch })
		.from(studentPreference)
		.where(
			or(
				ilike(studentPreference.uwePref1, courseCode),
				ilike(studentPreference.uwePref2, courseCode),
				ilike(studentPreference.uwePref3, courseCode)
			)
		);

	if (interestedStudents.length === 0) return json({ success: true, notified: 0 });

	// Collect all batch names that have interested students
	const affectedBatchNames = new Set<string>();
	for (const s of interestedStudents) {
		if (!s.batch) continue;
		for (const b of s.batch.split(',').map((x) => x.trim()).filter(Boolean)) {
			affectedBatchNames.add(b.toLowerCase());
		}
	}

	if (affectedBatchNames.size === 0) return json({ success: true, notified: 0 });

	// Find CRs who manage any of those batches (excluding the current user)
	const allAssignments = await db
		.select({ userId: crAssignment.userId, batchName: batch.name })
		.from(crAssignment)
		.innerJoin(batch, eq(crAssignment.batchId, batch.id))
		.where(ne(crAssignment.userId, locals.user.id));

	const crsTONotify = new Set<string>();
	for (const a of allAssignments) {
		if (affectedBatchNames.has(a.batchName.toLowerCase())) {
			crsTONotify.add(a.userId);
		}
	}

	if (crsTONotify.size === 0) return json({ success: true, notified: 0 });

	const message = `${courseCode} was moved in the timetable by ${locals.user.name} — this course is in your batch's UWE demand`;

	await db.insert(notification).values(
		[...crsTONotify].map((toUserId) => ({
			id: crypto.randomUUID(),
			toUserId,
			fromUserName: locals.user!.name,
			courseCode,
			message
		}))
	);

	return json({ success: true, notified: crsTONotify.size });
};
