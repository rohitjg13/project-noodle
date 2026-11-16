// Built by the timetable plugin in vite.config.ts from the sheet in src/lib/data
declare module 'virtual:timetable' {
	export const courses: import('$lib/types').Course[];
	/** Content hash of the parsed timetable — changes only when the sheet does */
	export const version: string;
}
