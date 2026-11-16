// Turns the timetable sheet's rows into the Course list the app works with. Runs at build
// time (see the timetable plugin in vite.config.ts) — the deployed server never opens the
// spreadsheet, so this must stay free of $lib / SvelteKit imports.
import { DAYS, baseCode, expandBlocks, parseDays, timeToMinutes, type Course } from './types.ts';

const normHeader = (k: string) => k.toLowerCase().replace(/[\s._-]/g, '');

export function parseTimetableRows(rows: Record<string, unknown>[]): Course[] {
	// One entry per weekly slot. Identical rows (the sheet repeats some) merge here, and a
	// row spanning several days ("MWF") becomes one slot per day.
	const slots = new Map<string, Course>();

	for (const row of rows) {
		const cells = new Map<string, string>();
		for (const [k, v] of Object.entries(row)) {
			if (v !== undefined && v !== null) cells.set(normHeader(k), String(v).trim());
		}
		const get = (...headers: string[]): string => {
			for (const h of headers) {
				const v = cells.get(normHeader(h));
				if (v !== undefined) return v;
			}
			return '';
		};

		const code = get('Course Code', 'Code');
		if (!code || code === '-') continue;
		const section = get('Section', 'Sec');
		const component = get('Component', 'Comp', 'ComponentType');
		const courseCode = section ? `${code}-${section}` : component ? `${code}-${component}` : code;

		// Programme (BIO2YR) and Student Block (BIO21, "ECE21 to ECE215") are separate
		// columns; older sheets had a single Batch/Major cell.
		let batches = [...expandBlocks(get('Programme')), ...expandBlocks(get('Student Block'))];
		if (!batches.length) batches = expandBlocks(get('Batch', 'Major', 'Batches'));

		const startTime = get('Start Time', 'Start', 'From');
		const endTime = get('End Time', 'End', 'To');
		const rawDay = get('Day', 'Days', 'Weekday');
		const days = parseDays(rawDay);

		// Unscheduled rows still belong in the catalogue (search, professor picker)
		for (const day of days.length ? days : ['']) {
			const id = `${courseCode}|${component}|${day}|${startTime}|${endTime}`;
			const existing = slots.get(id);
			if (existing) {
				for (const b of batches) if (!existing.major.split(' ').includes(b)) existing.major += ` ${b}`;
				continue;
			}
			slots.set(id, {
				sno: slots.size + 1,
				courseCode,
				courseName: get('Course Title', 'Course Name', 'Name', 'Title'),
				credits: 0,
				faculty: get('Instructor(s)', 'Faculty', 'Instructor', 'Teacher', 'Professor'),
				slot: section,
				room: get('Room', 'Venue', 'Location', 'Classroom', 'Rooms'),
				major: [...new Set(batches)].join(' '),
				day,
				startTime,
				endTime,
				courseType: get('Course Type', 'Type', 'CourseType', 'Category'),
				component,
				openAsUWE: /^(yes|true)$/i.test(get('Open as UWE', 'OpenAsUWE', 'UWE')),
				base: baseCode(courseCode),
				batches: [],
				startMin: timeToMinutes(startTime),
				endMin: timeToMinutes(endTime),
				key: ''
			});
		}
	}

	// A saved move is keyed by courseCode|component|originalDay. When one section meets
	// twice on the same day, the later slots get "Monday#2", "Monday#3" so each stays
	// independently movable instead of both snapping to the same override.
	const perDay = new Map<string, Course[]>();
	for (const c of slots.values()) {
		c.batches = c.major ? c.major.toUpperCase().split(' ') : [];
		const group = `${c.courseCode}|${c.component ?? ''}|${c.day}`;
		const list = perDay.get(group);
		if (list) list.push(c);
		else perDay.set(group, [c]);
	}
	for (const [group, list] of perDay) {
		list.sort((a, b) => a.startMin - b.startMin);
		list.forEach((c, i) => (c.key = i === 0 ? group : `${group}#${i + 1}`));
	}

	return [...slots.values()];
}

/** The weekday a slot key's originalDay part refers to: "Monday#2" → "Monday" */
export function keyDay(originalDay: string): string {
	return originalDay.split('#')[0];
}

export const isWeekday = (day: unknown): day is string =>
	typeof day === 'string' && DAYS.includes(day);
