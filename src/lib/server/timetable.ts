// The parsed timetable, held in memory for the life of the server. Everything the API
// needs to check a request against the real sheet is indexed here once.
import { courses, version } from 'virtual:timetable';
import type { Course } from '$lib/types';

export { courses };

/** Response body + validator for GET /api/timetable, serialised once */
export const timetableJson = JSON.stringify({ courses });
export const timetableEtag = `"tt-${version}"`;

/** Scheduled weekly slots by override key (`courseCode|component|originalDay`) */
export const slotsByKey = new Map<string, Course>();
/** Base course code → course title, for validating a watch-list add */
export const courseNames = new Map<string, string>();
/** Base codes of courses open as a UWE — the only ones a student may rank */
export const uweCodes = new Set<string>();

const batchSet = new Map<string, string>();
for (const c of courses) {
	if (!courseNames.has(c.base)) courseNames.set(c.base, c.courseName);
	if (c.openAsUWE) uweCodes.add(c.base);
	if (c.day && c.startMin < c.endMin) slotsByKey.set(c.key, c);
	// Keep the sheet's own spelling, one entry per case-insensitive name
	for (const name of c.major ? c.major.split(' ') : []) {
		if (!batchSet.has(name.toUpperCase())) batchSet.set(name.toUpperCase(), name);
	}
}

/** Every batch named in the sheet */
export const batchNames = [...batchSet.values()];

/** Faculty cells hold "Name[1234567]" id suffixes and comma-separated co-instructors */
export function professorsOf(course: Course): string[] {
	return course.faculty
		.split(',')
		.map((p) => p.replace(/\[[^\]]*\]/g, '').trim().toUpperCase())
		.filter(Boolean);
}
