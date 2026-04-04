import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { studentPreference, crAssignment, batch } from '$lib/server/db/schema';
import { eq, or, ilike } from 'drizzle-orm';
import { calculatePriorityScore } from '$lib/types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (locals.user.role !== 'cr' && locals.user.role !== 'super_admin') {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	// super_admin sees all students; CRs see only their assigned batches
	let allPrefs;
	if (locals.user.role === 'super_admin') {
		allPrefs = await db.select().from(studentPreference);
	} else {
		const assignments = await db
			.select({ batchName: batch.name })
			.from(crAssignment)
			.innerJoin(batch, eq(crAssignment.batchId, batch.id))
			.where(eq(crAssignment.userId, locals.user.id));

		const batchNames = assignments.map((a) => a.batchName);
		allPrefs = batchNames.length === 0
			? []
			: await db
				.select()
				.from(studentPreference)
				.where(or(...batchNames.map((name) => ilike(studentPreference.batch, `%${name}%`))));
	}

	const demandMap = new Map<
		string,
		{ courseCode: string; p1: number; p2: number; p3: number; total: number }
	>();

	for (const pref of allPrefs) {
		for (const [code, rank] of [
			[pref.uwePref1, 1],
			[pref.uwePref2, 2],
			[pref.uwePref3, 3]
		] as [string | null, number][]) {
			if (!code) continue;
			const existing = demandMap.get(code) || { courseCode: code, p1: 0, p2: 0, p3: 0, total: 0 };
			if (rank === 1) existing.p1++;
			else if (rank === 2) existing.p2++;
			else existing.p3++;
			existing.total++;
			demandMap.set(code, existing);
		}
	}

	const demand = Array.from(demandMap.values())
		.map((d) => ({
			...d,
			priorityScore: calculatePriorityScore(d.p1, d.p2, d.p3)
		}))
		.sort((a, b) => b.priorityScore - a.priorityScore);

	return json({ demand, totalStudents: allPrefs.length });
};
