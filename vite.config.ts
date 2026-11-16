import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import * as XLSX from 'xlsx';
import { parseTimetableRows } from './src/lib/timetable-parse';

// The timetable spreadsheet is parsed once, here, and inlined into the server bundle as
// `virtual:timetable`. The deployed app never ships the sheet as a public asset, never
// parses it per request, and doesn't carry the xlsx parser at runtime at all.
function timetable(): Plugin {
	const id = 'virtual:timetable';
	const resolved = '\0' + id;
	const dir = join(import.meta.dirname, 'src/lib/data');

	return {
		name: 'noodle-timetable',
		resolveId: (source) => (source === id ? resolved : undefined),
		load(source) {
			if (source !== resolved) return;
			const files = readdirSync(dir).sort();
			const file =
				files.find((f) => /\.xlsx?$/i.test(f)) ?? files.find((f) => /\.csv$/i.test(f));

			let courses: ReturnType<typeof parseTimetableRows> = [];
			if (file) {
				const path = join(dir, file);
				this.addWatchFile(path);
				const workbook = /\.csv$/i.test(file)
					? XLSX.read(readFileSync(path, 'utf8'), { type: 'string' })
					: XLSX.read(readFileSync(path), { type: 'buffer' });
				const sheet = workbook.Sheets[workbook.SheetNames[0]];
				courses = parseTimetableRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet));
			} else {
				this.warn(`no timetable file in ${dir}`);
			}

			const json = JSON.stringify(courses);
			const version = createHash('sha256').update(json).digest('base64url').slice(0, 16);
			// JSON.parse of one string literal is much cheaper to boot than an object literal
			return `export const version = ${JSON.stringify(version)};\nexport const courses = JSON.parse(${JSON.stringify(json)});\n`;
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), timetable(), sveltekit()],
	server: { allowedHosts: true }
});
