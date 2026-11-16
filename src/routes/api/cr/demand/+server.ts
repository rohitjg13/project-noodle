import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { studentPreference } from '$lib/server/db/schema';
import { managedBatches, prefInBatches, requireManager } from '$lib/server/api';
import { calculatePriorityScore } from '$lib/types';

const columns = {
	minor: studentPreference.minor,
	uwePref1: studentPreference.uwePref1,
	uwePref2: studentPreference.uwePref2,
	uwePref3: studentPreference.uwePref3
};

// GET /api/cr/demand — UWE and minor demand. Admins see all students; CRs see only the
// students of their assigned batches.
export const GET: RequestHandler = async ({ locals }) => {
	const user = requireManager(locals);

	let allPrefs: { minor: string | null; uwePref1: string | null; uwePref2: string | null; uwePref3: string | null }[];
	if (user.role === 'super_admin') {
		allPrefs = await db.select(columns).from(studentPreference);
	} else {
		const batches = await managedBatches(user.id);
		allPrefs = batches.size
			? await db.select(columns).from(studentPreference).where(prefInBatches(batches))
			: [];
	}

	const demandMap = new Map<string, { courseCode: string; p1: number; p2: number; p3: number; total: number }>();
	const minorMap = new Map<string, number>();

	for (const pref of allPrefs) {
		if (pref.minor) minorMap.set(pref.minor, (minorMap.get(pref.minor) ?? 0) + 1);
		[pref.uwePref1, pref.uwePref2, pref.uwePref3].forEach((raw, i) => {
			if (!raw) return;
			const code = raw.toUpperCase();
			const entry = demandMap.get(code) ?? { courseCode: code, p1: 0, p2: 0, p3: 0, total: 0 };
			if (i === 0) entry.p1++;
			else if (i === 1) entry.p2++;
			else entry.p3++;
			entry.total++;
			demandMap.set(code, entry);
		});
	}

	const demand = [...demandMap.values()]
		.map((d) => ({ ...d, priorityScore: calculatePriorityScore(d.p1, d.p2, d.p3) }))
		.sort((a, b) => b.priorityScore - a.priorityScore);

	const minorDemand = [...minorMap.entries()]
		.map(([minor, count]) => ({ minor, count }))
		.sort((a, b) => b.count - a.count);

	return json({ demand, minorDemand, totalStudents: allPrefs.length });
};
