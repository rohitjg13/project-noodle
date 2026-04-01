import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as XLSX from 'xlsx';
import type { Course } from '$lib/types';

const dataFiles = import.meta.glob('$lib/data/*.{xlsx,xls,csv}', {
	query: '?url',
	import: 'default',
	eager: true
});

export const GET: RequestHandler = async ({ fetch }) => {
	try {
		const filePaths = Object.keys(dataFiles);
		if (filePaths.length === 0) {
			return json({ error: 'No timetable file found' }, { status: 404 });
		}

		const targetFile =
			filePaths.find((f) => f.endsWith('.xlsx') || f.endsWith('.xls')) ||
			filePaths.find((f) => f.endsWith('.csv'));

		if (!targetFile) {
			return json({ error: 'No supported file found' }, { status: 404 });
		}

		const url = dataFiles[targetFile] as string;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

		const buffer = await response.arrayBuffer();
		const workbook = targetFile.endsWith('.csv')
			? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
			: XLSX.read(buffer, { type: 'array' });

		const worksheet = workbook.Sheets[workbook.SheetNames[0]];
		const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
		const courses = parseData(jsonData);

		return json(
			{ courses },
			{ headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
		);
	} catch (error) {
		console.error('Error loading timetable:', error);
		return json({ error: 'Failed to load timetable: ' + String(error) }, { status: 500 });
	}
};

function parseData(jsonData: Record<string, unknown>[]): Course[] {
	return jsonData
		.map((row, index) => {
			const getValue = (keys: string[]): string => {
				for (const key of keys) {
					if (row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
					const found = Object.keys(row).find(
						(k) =>
							k.toLowerCase().replace(/[\s._-]/g, '') ===
							key.toLowerCase().replace(/[\s._-]/g, '')
					);
					if (found && row[found] !== undefined && row[found] !== null)
						return String(row[found]).trim();
				}
				return '';
			};

			const getNum = (keys: string[]): number => {
				const val = getValue(keys);
				const parsed = parseFloat(val);
				return isNaN(parsed) ? 0 : parsed;
			};

			const courseCode = getValue(['Course Code', 'CourseCode', 'Code']);
			const section = getValue(['Section', 'Sec']);
			const component = getValue(['Component', 'Comp', 'ComponentType']);
			const openAsUWEVal = getValue(['Open as UWE', 'OpenAsUWE', 'UWE', 'Open As UWE']);

			let fullCode = courseCode;
			if (section) fullCode = `${courseCode}-${section}`;
			else if (component) fullCode = `${courseCode}-${component}`;

			return {
				sno: index + 1,
				courseCode: fullCode,
				courseName: getValue(['Course Name', 'CourseName', 'Name', 'Title']),
				credits: getNum(['L/T/P Hour']),
				faculty: getValue(['Faculty', 'Instructor', 'Teacher', 'Professor']),
				slot: section,
				room: getValue(['Room', 'Venue', 'Location', 'Classroom', 'Rooms']),
				major: getValue(['Batch', 'Major', 'Batches', 'Program']),
				day: getValue(['Day', 'Days', 'Weekday']),
				startTime: getValue(['Start Time', 'StartTime', 'Start', 'From']),
				endTime: getValue(['End Time', 'EndTime', 'End', 'To']),
				courseType: getValue(['Type', 'CourseType', 'Category']),
				component,
				openAsUWE:
					openAsUWEVal.toLowerCase() === 'yes' || openAsUWEVal.toLowerCase() === 'true',
				remarks: getValue(['Remarks'])
			};
		})
		.filter((c) => c.courseCode && c.courseCode !== '-');
}
