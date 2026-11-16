<script lang="ts">
	import { browser } from '$app/environment';
	import type { Course, ConflictLevel, SlotPosition } from '$lib/types';
	import { baseCode, timeToMinutes, minutesToTime, getConflictLevel, countConflicts } from '$lib/types';

	let { data } = $props();

	const isAdmin = data.user.role === 'super_admin';
	const canManage = data.user.role === 'cr' || isAdmin;
	// The five most-wanted UWEs across all students — moving one also raises the heads-up
	const globalTop5: { code: string; total: number }[] = data.globalTop5 ?? [];
	// Courses other CRs track — drives the heads-up modal before moving a class
	const watchCounts = new Map<string, number>(
		(data.watchCounts ?? []).map((w: { code: string; count: number }) => [w.code.toUpperCase(), w.count])
	);

	// CRs and admins can flip to the student view; students only ever see that one
	let viewAsStudent = $state(!canManage);
	let activeTab = $state<'preferences' | 'mytimetable' | 'demand' | 'courses' | 'timetable' | 'settings'>(canManage ? 'demand' : 'preferences');

	// Course catalogue from the timetable file. Raw: ~1,200 rows that are never mutated
	// in place — proxying each one made every scan of the list several times slower.
	let courses = $state.raw<Course[]>([]);
	let loadingCourses = $state(true);

	// This CR's manually added courses
	let myCourses = $state<{ courseCode: string; courseName: string | null }[]>(data.myCourses ?? []);
	let search = $state('');
	let searchOpen = $state(false);
	let addingCode = $state('');

	// Student view: saved batch + preferences
	const savedBatch: string = data.preference?.batch ?? '';
	const savedBatchList = savedBatch.split(',').map((b) => b.trim()).filter(Boolean);
	let studentBatch = $state(savedBatch); // persisted batch string from the DB
	let editingBatch = $state(!savedBatch); // show the batch editor until one is saved
	let minor = $state(data.preference?.minor ?? '');
	let uwePref1 = $state(data.preference?.uwePref1 ?? '');
	let uwePref2 = $state(data.preference?.uwePref2 ?? '');
	let uwePref3 = $state(data.preference?.uwePref3 ?? '');
	let minorOnly = $state(!!data.preference?.minor && !data.preference?.uwePref1 && !data.preference?.uwePref2 && !data.preference?.uwePref3);
	let locked = $state(data.preference?.locked ?? false);
	let submitting = $state(false);
	let batchSubmitting = $state(false);
	let batchError = $state('');
	let prefError = $state('');
	let prefSuccess = $state('');

	// CR view: what the students of this CR's batches asked for
	type Demand = { courseCode: string; p1: number; p2: number; p3: number; total: number; priorityScore: number };
	let demand = $state.raw<Demand[]>([]);
	let minorDemand = $state.raw<{ minor: string; count: number }[]>([]);
	let totalStudents = $state(0);
	let loadingCR = $state(canManage);
	let deptFilter = $state('');
	let demandSort = $state<'conflict' | 'score' | 'total'>('conflict');
	let demandSortDir = $state<'desc' | 'asc'>('asc'); // default: least conflict first
	let lockSubmitting = $state(false);

	// Constraints
	let constraints = $state<{ id: number; professorName: string; day: string; startTime: string | null; endTime: string | null; allDay: boolean; reason?: string | null }[]>(data.constraints ?? []);

	// Notifications — seeded from the server load, then polled so a move by another CR
	// lands without a refresh. Ids dismissed locally are held back until the server
	// confirms, otherwise an in-flight dismissal would reappear on the next poll.
	let notifications = $state<{ id: string; fromUserName: string; courseCode: string; message: string; createdAt: number }[]>(data.notifications ?? []);
	let dismissedIds = new Set<string>();
	let knownNotifIds = new Set<string>((data.notifications ?? []).map((n: { id: string }) => n.id));

	// Timetable state
	let dragCourse = $state<Course | null>(null);
	let dragOriginalDay = $state('');
	let dragIsOverlay = $state(false);
	let dragOffsetY = $state(0);
	let dragOverSlot = $state<{ day: string; startMin: number } | null>(null);

	// Touch drag state (mobile)
	let touchDragCourse = $state<Course | null>(null);
	let touchDragOriginalDay = $state('');
	let touchDragIsOverlay = $state(false);
	let touchDragOffsetX = $state(0);
	let touchDragOffsetY = $state(0);
	let touchX = $state(0);
	let touchY = $state(0);
	let touchGhostW = $state(0);
	let touchGhostH = $state(0);
	type PendingDrop = { course: Course; origDay: string; day: string; newStart: string; newEnd: string };
	let moveWarnModal = $state<{ courseCode: string; watchers: number; students: number; pending: PendingDrop } | null>(null);
	// Override key: `courseCode|component|originalDay` — each day-slot independently overridable
	// Initialize from server-loaded data so overrides are available on first render
	function buildOverrideMapFromArray(blocks: { courseCode: string; component?: string | null; originalDay?: string | null; day: string; startTime: string; endTime: string }[]) {
		const map = new Map<string, OverridePos>();
		for (const b of blocks) {
			const origDay = b.originalDay ?? b.day;
			map.set(`${b.courseCode}|${b.component ?? ''}|${origDay}`, {
				day: b.day,
				startTime: b.startTime,
				endTime: b.endTime,
				startMin: timeToMinutes(b.startTime),
				endMin: timeToMinutes(b.endTime)
			});
		}
		return map;
	}
	// A saved position with its times pre-parsed, so the grid never re-parses per render
	type OverridePos = SlotPosition & { startMin: number; endMin: number };
	// $state.raw: the map is only ever replaced whole, so deep proxying it would just tax
	// every read in the grid's hot loops.
	let scheduleOverrides = $state.raw(buildOverrideMapFromArray(data.savedSchedule ?? []));
	let showOriginals = $state(true); // ghosts of pre-move positions are on unless toggled off
	let syncStatus = $state<'idle' | 'saving' | 'saved' | 'error' | 'polling'>('idle');
	let lastSyncedAt = $state(0);
	// Undo/redo history for moves — session-only, max 3 entries. Entries store absolute
	// positions (not map refs) so they survive the polling rebuild of scheduleOverrides.
	type MovePos = SlotPosition;
	type MoveEntry = { key: string; course: Course; origDay: string; before: MovePos | null; after: MovePos };
	let undoStack = $state<MoveEntry[]>([]);
	let redoStack = $state<MoveEntry[]>([]);
	// Time range extension (in whole hours, relative to auto-detected range)
	let extraHoursBefore = $state(0);
	let extraHoursAfter = $state(1); // start with 1hr extra at the end
	let toast = $state('');
	let toastTimeout: ReturnType<typeof setTimeout>;

	// Theme (dark default, persisted in localStorage; initial attribute is set in app.html)
	let theme = $state<'dark' | 'light'>('dark');
	$effect(() => {
		theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
	});
	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		document.documentElement.setAttribute('data-theme', theme);
		try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
	}

	// Constraint form
	let profName = $state('');
	let profSuggestOpen = $state(false);
	let constraintDay = $state('Monday');
	let allDay = $state(false);
	let cStartTime = $state('09:00');
	let cEndTime = $state('17:00');
	let cReason = $state('');
	let savingConstraint = $state(false);

	// Professor picker — names + their course codes from the XLSX faculty column.
	// Faculty cells can hold "Name[1234567]" id suffixes and comma-separated multiple profs.
	function normalizeFaculty(raw: string): string[] {
		return raw.split(',').map((p) => p.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean);
	}
	let professorOptions = $derived.by(() => {
		const map = new Map<string, { name: string; codes: Set<string> }>();
		for (const c of courses) {
			if (!c.faculty) continue;
			const base = c.base;
			for (const name of normalizeFaculty(c.faculty)) {
				const key = name.toUpperCase();
				const entry = map.get(key) ?? { name, codes: new Set<string>() };
				entry.codes.add(base);
				map.set(key, entry);
			}
		}
		return [...map.values()]
			.map((e) => ({ name: e.name, codes: [...e.codes].sort() }))
			.sort((a, b) => a.name.localeCompare(b.name));
	});
	let profSuggestions = $derived.by(() => {
		if (!profSuggestOpen) return [];
		const q = profName.trim().toUpperCase();
		const opts = professorOptions;
		const matches = q
			? opts.filter((p) => p.name.toUpperCase().includes(q) || p.codes.some((c) => c.toUpperCase().includes(q)))
			: opts;
		return matches.slice(0, 12);
	});

	// Grid cells are one hour tall and start on the hour
	const cellHour = (min: number) => Math.floor(min / 60) * 60;
	function groupByCell<T extends { day: string; startMin: number }>(blocks: T[]): Map<string, T[]> {
		const map = new Map<string, T[]>();
		for (const b of blocks) {
			const cell = `${b.day}|${cellHour(b.startMin)}`;
			const list = map.get(cell);
			if (list) list.push(b);
			else map.set(cell, [b]);
		}
		return map;
	}

	function showToast(msg: string) {
		toast = msg;
		clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => (toast = ''), 3000);
	}

	// ---------- Batch picker + read-only timetable ----------
	// Shared by the student's batch editor, their "my timetable", and the CR's "browse batch"
	let batchInputs = $state<string[]>(savedBatchList.length ? savedBatchList : ['']);
	let batchSuggestions = $state<string[][]>(savedBatchList.length ? savedBatchList.map(() => []) : [[]]);
	let selectedBatches = $state<string[]>(savedBatchList);

	let allBatches = $derived.by(() => {
		const set = new Set<string>();
		for (const c of courses) for (const b of c.batches) set.add(b);
		return [...set].sort();
	});

	function getSuggestions(input: string): string[] {
		if (!input || input.length < 1) return [];
		const q = input.toUpperCase();
		return allBatches.filter((b) => b.includes(q) && b !== q).slice(0, 12);
	}

	function onBatchInput(i: number) {
		batchSuggestions[i] = getSuggestions(batchInputs[i]);
		batchSuggestions = [...batchSuggestions];
	}

	function selectBatchSuggestion(i: number, val: string) {
		batchInputs[i] = val;
		batchSuggestions[i] = [];
		batchInputs = [...batchInputs];
		batchSuggestions = [...batchSuggestions];
	}

	function addBatchInput() {
		if (batchInputs.length >= 4) return;
		batchInputs = [...batchInputs, ''];
		batchSuggestions = [...batchSuggestions, []];
	}

	function removeBatchInput(i: number) {
		batchInputs = batchInputs.filter((_, idx) => idx !== i);
		batchSuggestions = batchSuggestions.filter((_, idx) => idx !== i);
	}

	function loadBatches() {
		const valid = batchInputs.map((b) => b.trim().toUpperCase()).filter(Boolean);
		if (!valid.length) return;
		selectedBatches = valid;
	}

	let browseCourses = $derived(
		selectedBatches.length
			? courses.filter((c) => selectedBatches.some((ub) => c.batches.some((m) => m.includes(ub) || ub.includes(m))))
			: []
	);
	let browseBlocks = $derived.by(() => {
		const blocks: { course: Course; day: string; startMin: number; endMin: number }[] = [];
		for (const c of browseCourses) {
			if (!c.day || c.startMin >= c.endMin) continue;
			blocks.push({ course: c, day: c.day, startMin: c.startMin, endMin: c.endMin });
		}
		return blocks;
	});
	// Blocks bucketed by the grid cell they start in, so a cell looks its blocks up
	// instead of filtering the whole list once per cell
	let browseCells = $derived(groupByCell(browseBlocks));
	let sMinT = $derived(browseBlocks.length ? Math.min(...browseBlocks.map((b) => b.startMin)) : 480);
	let sMaxT = $derived(browseBlocks.length ? Math.max(...browseBlocks.map((b) => b.endMin)) : 1080);
	let sRMin = $derived(Math.floor(sMinT / 60) * 60);
	let sRMax = $derived(Math.ceil(sMaxT / 60) * 60);
	let sTotalMin = $derived(sRMax - sRMin);
	let sTimeLabels = $derived(Array.from({ length: Math.floor(sTotalMin / 60) + 1 }, (_, i) => ({ mins: sRMin + i * 60, label: minutesToTime(sRMin + i * 60) })));

	// ---------- Student preferences ----------
	// One option per course the sheet marks open-as-UWE
	let uweCourseOptions = $derived([...new Map(courses.filter((c) => c.openAsUWE).map((c) => [c.base, c])).values()]);
	let minorPrograms = $derived(
		[...new Set(courses.filter((c) => c.courseType?.toLowerCase().includes('minor')).map((c) => c.courseName))]
	);

	// A choice saved against an older sheet may name a course this one doesn't offer —
	// drop it from the form rather than resubmit a code the server will refuse
	$effect(() => {
		if (!courses.length) return;
		const offered = new Set(uweCourseOptions.map((c) => c.base));
		if (uwePref1 && !offered.has(uwePref1.toUpperCase())) uwePref1 = '';
		if (uwePref2 && !offered.has(uwePref2.toUpperCase())) uwePref2 = '';
		if (uwePref3 && !offered.has(uwePref3.toUpperCase())) uwePref3 = '';
	});

	// POST JSON; resolves to an error message, or '' when it worked
	async function postJson(url: string, body: unknown): Promise<string> {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) return '';
			return (await res.json().catch(() => null))?.message || 'Something went wrong';
		} catch {
			return 'Network error — try again';
		}
	}

	async function saveBatch() {
		const valid = [...new Set(batchInputs.map((b) => b.trim().toUpperCase()).filter(Boolean))];
		if (!valid.length) { batchError = 'Enter at least one batch code'; return; }
		batchError = '';
		batchSubmitting = true;
		const batchStr = valid.join(',');
		batchError = await postJson('/api/student/preferences', { batch: batchStr, minor, uwePref1, uwePref2, uwePref3 });
		batchSubmitting = false;
		if (batchError) return;
		studentBatch = batchStr;
		selectedBatches = valid;
		editingBatch = false;
	}

	async function submitPreferences() {
		prefError = '';
		prefSuccess = '';
		if (!studentBatch) { prefError = 'Set your batch first'; return; }
		if (minorOnly) {
			if (!minor) { prefError = 'Select a minor or uncheck minor-only'; return; }
		} else if (!uwePref1) { prefError = 'At least your first UWE preference is required'; return; }
		const choices = [uwePref1, uwePref2, uwePref3].filter(Boolean);
		if (new Set(choices).size !== choices.length) { prefError = 'No duplicate UWE preferences'; return; }

		submitting = true;
		prefError = await postJson('/api/student/preferences', { batch: studentBatch, minor, uwePref1, uwePref2, uwePref3 });
		submitting = false;
		if (!prefError) prefSuccess = 'preferences saved';
	}

	// CR: lock or unlock editing for the students of their batches
	async function toggleLockAll() {
		if (lockSubmitting) return;
		lockSubmitting = true;
		const newState = !locked;
		const err = await postJson('/api/student/preferences/lock', { locked: newState });
		if (err) showToast(err);
		else { locked = newState; showToast(newState ? 'preferences locked' : 'preferences unlocked'); }
		lockSubmitting = false;
	}

	// ---------- Course watch list ----------
	// Every course row that actually has a scheduled slot
	let scheduledCourses = $derived(courses.filter((c) => c.day && c.startMin < c.endMin));
	// …and the same rows by base course code, for the per-course conflict maths
	let rowsByBase = $derived.by(() => {
		const map = new Map<string, Course[]>();
		for (const c of scheduledCourses) {
			const list = map.get(c.base);
			if (list) list.push(c);
			else map.set(c.base, [c]);
		}
		return map;
	});

	let namesByBase = $derived(new Map(courses.map((c) => [c.base, c.courseName])));

	// Every course whose clashes this CR cares about: their own watch list plus whatever
	// their students ranked. The conflict maths below runs over this one list.
	let trackedCodes = $derived([...new Set([...myCourses.map((c) => c.courseCode), ...demand.map((d) => d.courseCode)])]);

	// Search the timetable file — one hit per base course code
	let searchResults = $derived.by(() => {
		const q = search.trim().toUpperCase();
		if (q.length < 2) return [];
		const watched = new Set(myCourses.map((c) => c.courseCode));
		const seen = new Set<string>();
		const out: { code: string; name: string; watched: boolean }[] = [];
		for (const c of courses) {
			const base = c.base;
			if (seen.has(base)) continue;
			if (!base.includes(q) && !(c.courseName ?? '').toUpperCase().includes(q)) continue;
			seen.add(base);
			out.push({ code: base, name: c.courseName, watched: watched.has(base) });
			if (out.length >= 20) break;
		}
		return out;
	});

	async function addCourse(code: string, name: string) {
		if (myCourses.some((c) => c.courseCode === code)) return;
		addingCode = code;
		const res = await fetch('/api/cr/courses', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ courseCode: code, courseName: name })
		});
		addingCode = '';
		if (!res.ok) { showToast('could not add course'); return; }
		if (myCourses.some((c) => c.courseCode === code)) return; // a double tap raced us here
		myCourses = [...myCourses, { courseCode: code, courseName: name }];
		enabledCourses = new Set([...enabledCourses, code]);
		showToast(`${code} added`);
	}

	async function removeCourse(code: string) {
		const prev = myCourses;
		myCourses = myCourses.filter((c) => c.courseCode !== code);
		const next = new Set(enabledCourses);
		next.delete(code);
		enabledCourses = next;
		const res = await fetch('/api/cr/courses', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ courseCode: code })
		});
		if (!res.ok) { myCourses = prev; showToast('could not remove course'); }
	}

	// All scheduled rows of a course (its LEC + TUT + PRAC components, and every day each
	// meets), matched by base code and deduped by component+day+time. A student attends ALL
	// of these, so the course's conflict is the WORST across every row — never the best.
	// (The component is part of the full courseCode, e.g. "ART210/AMP1001-LEC1".)
	// For conflict maths, parallel sections that meet at the same time count once
	// (deduped by component+day+time) — the overlay still draws every section.
	let conflictRowsByBase = $derived.by(() => {
		const map = new Map<string, Course[]>();
		for (const [base, rows] of rowsByBase) {
			const seen = new Set<string>();
			map.set(base, rows.filter((c) => {
				const sig = `${c.component ?? ''}|${c.day}|${c.startTime}`;
				return seen.has(sig) ? false : (seen.add(sig), true);
			}));
		}
		return map;
	});
	function courseBaseRows(code: string): Course[] {
		return conflictRowsByBase.get(code.toUpperCase()) ?? [];
	}

	function computeTrafficLight(courseCode: string): ConflictLevel {
		const rows = courseBaseRows(courseCode);
		if (!rows.length) return 'green';
		// Worst conflict across every component/row of the course (don't clash with self)
		const self = courseCode.toUpperCase();
		const relevant = crBatchCourses.filter((k) => k.base !== self);
		let level: ConflictLevel = 'green';
		for (const v of rows) {
			const l = getConflictLevel(v, relevant);
			if (l === 'red') return 'red';
			if (l === 'yellow') level = 'yellow';
		}
		return level;
	}

	// Traffic lights for the tracked courses, worked out once per change to the timetable
	// or the list — the grid asks for the same handful of codes hundreds of times a render.
	let trafficLights = $derived.by(() => {
		const map = new Map<string, ConflictLevel>();
		for (const code of trackedCodes) map.set(code, computeTrafficLight(code));
		return map;
	});

	function getTrafficLight(courseCode: string): ConflictLevel {
		return trafficLights.get(courseCode) ?? computeTrafficLight(courseCode);
	}

	// Adjusted traffic light map — recomputes reactively when scheduleOverrides changes.
	// Uses overridden positions for both the tracked course and the batch courses, so a
	// conflict the CR has already dragged away shows as cleared.
	let adjustedConflictMap = $derived.by(() => {
		const map = new Map<string, ConflictLevel>();
		if (scheduleOverrides.size === 0) return map;

		const adjustedCores = adjustedCrCores;

		for (const code of trackedCodes) {
			const orig = getTrafficLight(code);
			if (orig === 'green') continue; // already fine, skip
			const relevant = adjustedCores.filter((k) => k.base !== code.toUpperCase());
			let level: ConflictLevel = 'green';
			outer: for (const v of courseBaseRows(code)) {
				for (const slot of adjustedSlotsOf(v)) {
					const slotLevel = getConflictLevel(slot, relevant);
					if (slotLevel === 'red') { level = 'red'; break outer; }
					if (slotLevel === 'yellow') level = 'yellow';
				}
			}
			map.set(code, level);
		}
		return map;
	});

	// A slot where it currently sits — its saved move applied, if it has one
	function moved(c: Course): Course {
		const override = scheduleOverrides.get(c.key);
		return override ? { ...c, ...override } : c;
	}
	function adjustedSlotsOf(c: Course): Course[] {
		return [moved(c)];
	}

	// All CR-batch courses (across every assigned batch, deduped) with overrides applied,
	// expanded one entry per day-slot. Spanning all batches is how multiple batches are
	// taken into consideration; dedup avoids counting a class shared by two batches twice.
	let adjustedCrCores = $derived.by(() => {
		const out: Course[] = [];
		for (const c of crBatchCourses) out.push(moved(c));
		return out;
	});

	// Conflict counts per tracked course: red/yellow overlaps summed over EVERY component,
	// row and day-slot of the course against the CR's (override-adjusted) batch timetable.
	// A student attends all components, so every overlap counts — none are masked.
	let courseConflicts = $derived.by(() => {
		const map = new Map<string, { red: number; yellow: number; score: number }>();
		const cores = adjustedCrCores;
		for (const code of trackedCodes) {
			const relevant = cores.filter((k) => k.base !== code.toUpperCase());
			let red = 0, yellow = 0;
			for (const v of courseBaseRows(code)) {
				for (const slot of adjustedSlotsOf(v)) {
					const counts = countConflicts(slot, relevant);
					red += counts.red;
					yellow += counts.yellow;
				}
			}
			map.set(code, { red, yellow, score: red * 2 + yellow });
		}
		return map;
	});

	// CR batch names (all assigned batches)
	let crBatchNames = $derived(
		(data.crBatches ?? []).map((b: { batch: { name: string } }) => b.batch.name.toUpperCase())
	);

	// Which of the CR's batches the grid is showing — any combination of them.
	// Empty set means all assigned batches. Lectures are tagged with the year batch
	// (BIO1YR) while their tutorials and practicals are tagged with the sub-batch
	// (BIO11 / BIO12), so this is also how you switch which TUT/PRAC sections show.
	let batchViews = $state<Set<string>>(new Set());
	let viewedBatchNames = $derived(batchViews.size ? [...batchViews] : crBatchNames);

	function toggleBatchView(bn: string) {
		const next = new Set(batchViews);
		if (next.has(bn)) next.delete(bn);
		else next.add(bn);
		batchViews = next;
	}

	// CR timetable: all courses matching ANY viewed batch, deduped
	let viewedBatchSet = $derived(new Set<string>(viewedBatchNames));

	// TUT/PRAC rows belong to a specific sub-batch — label the block with it so two
	// practicals of the same course are tellable apart when viewing all batches.
	function sectionBatch(c: Course): string {
		const comp = (c.component ?? '').toUpperCase();
		if (!comp.startsWith('TUT') && !comp.startsWith('PRAC')) return '';
		return (c.major || '').trim().toUpperCase();
	}

	// Short classes get a block too small for their own name, so the full details go in a
	// hover tooltip and — since hover doesn't exist on touch — in a toast when tapped.
	function blockDetails(c: Course): string {
		return [
			`${c.base} — ${c.courseName}`,
			c.component,
			sectionBatch(c),
			c.room,
			normalizeFaculty(c.faculty || '').join(', ')
		].filter(Boolean).join(' · ');
	}

	// Hover card for timetable blocks. One shared element positioned at the cursor rather
	// than a child of the block, which would be clipped by the block's own overflow:hidden.
	let hoverInfo = $state<{ text: string; warn: string | null; x: number; y: number } | null>(null);

	function hoverAt(e: MouseEvent, c: Course, warn: string | null) {
		// Flip the card to the other side of the cursor near the viewport edge
		const x = e.clientX + 360 > window.innerWidth ? e.clientX - 350 : e.clientX + 14;
		const y = e.clientY + 110 > window.innerHeight ? e.clientY - 100 : e.clientY + 16;
		hoverInfo = { text: blockDetails(c), warn, x: Math.max(8, x), y: Math.max(8, y) };
	}

	// The viewed batches' weekly slots (saved moves are applied in calendarBlocks). Every
	// slot is its own row — a class meeting Mon/Wed/Fri is three — and the sheet's
	// duplicates were already merged when it was parsed.
	let crBatchCourses = $derived(
		viewedBatchSet.size ? scheduledCourses.filter((c) => c.batches.some((b) => viewedBatchSet.has(b))) : []
	);

	// Every scheduled slot by its override key — where the sheet originally put it
	let slotsByKey = $derived(new Map(scheduledCourses.map((c) => [c.key, c])));

	// Ghost blocks: original positions of moved courses (key = courseCode|component|originalDay)
	type GhostBlock = { courseCode: string; courseName: string; day: string; startMin: number; endMin: number };
	let ghostBlocks = $derived.by(() => {
		if (!showOriginals) return [] as GhostBlock[];
		const blocks: GhostBlock[] = [];
		for (const [key, override] of scheduleOverrides) {
			const orig = slotsByKey.get(key);
			if (!orig) continue;
			if (orig.day === override.day && orig.startMin === override.startMin) continue; // not moved
			if (ttDeptFilter && deptPrefix(orig.courseCode) !== ttDeptFilter) continue;
			blocks.push({ courseCode: orig.courseCode, courseName: orig.courseName, day: orig.day!, startMin: orig.startMin, endMin: orig.endMin });
		}
		return blocks;
	});
	let ghostCells = $derived(groupByCell(ghostBlocks));

	// Tracked-course overlay on the CR timetable — everything added starts visible
	let enabledCourses = $state<Set<string>>(new Set((data.myCourses ?? []).map((c: { courseCode: string }) => c.courseCode)));

	// Extract dept prefix: letters before any digit/dash/space, e.g. "ECE204" → "ECE", "PHL" → "PHL"
	function deptPrefix(code: string) { return code.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? code; }

	function relativeTime(epoch: number): string {
		const diff = Date.now() - epoch;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	// Headline tally for the courses tab — the question a CR opens the page with
	let trackedSummary = $derived.by(() => {
		let clear = 0, overlap = 0, clash = 0;
		for (const c of myCourses) {
			const lvl = adjustedConflictMap.get(c.courseCode) ?? getTrafficLight(c.courseCode);
			if (lvl === 'red') clash++;
			else if (lvl === 'yellow') overlap++;
			else clear++;
		}
		return { clear, overlap, clash };
	});

	// Watch-list ordering, shared by the courses list and the overlay chips
	let listSort = $state<'course' | 'conflict'>('course');
	let sortedMyCourses = $derived.by(() => {
		const list = [...myCourses];
		if (listSort === 'conflict') {
			return list.sort((a, b) => {
				const ca = courseConflicts.get(a.courseCode)?.score ?? 0;
				const cb = courseConflicts.get(b.courseCode)?.score ?? 0;
				if (ca !== cb) return ca - cb;
				return a.courseCode.localeCompare(b.courseCode);
			});
		}
		return list.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
	});

	function toggleCourseOverlay(code: string) {
		const next = new Set(enabledCourses);
		if (next.has(code)) next.delete(code);
		else next.add(code);
		enabledCourses = next;
	}

	// ---------- Student demand ----------
	let demandDepts = $derived([...new Set(demand.map((d) => deptPrefix(d.courseCode)))].sort());
	const conflictScore = (code: string) => courseConflicts.get(code)?.score ?? 0;
	// Least conflict first; among equals, most demanded first
	const byLeastConflict = (a: Demand, b: Demand) =>
		conflictScore(a.courseCode) - conflictScore(b.courseCode) || b.priorityScore - a.priorityScore;

	let filteredDemand = $derived.by(() => {
		const items = deptFilter ? demand.filter((d) => deptPrefix(d.courseCode) === deptFilter) : demand;
		const dir = demandSortDir === 'asc' ? -1 : 1;
		return [...items].sort((a, b) => {
			if (demandSort === 'conflict') return dir * (conflictScore(b.courseCode) - conflictScore(a.courseCode)) || b.priorityScore - a.priorityScore;
			return dir * (demandSort === 'total' ? b.total - a.total : b.priorityScore - a.priorityScore);
		});
	});

	// Ordering for the timetable tab's demanded-UWE overlay: by raw demand or least conflict
	let topUweMode = $state<'demand' | 'conflict'>('conflict');
	let rankedDemand = $derived(topUweMode === 'demand' ? demand : [...demand].sort(byLeastConflict));
	let topDemandedUWEs = $derived(rankedDemand.slice(0, 3).map((d) => d.courseCode));
	// "Other demanded UWEs": by course code (groups by dept), demand, or least conflict
	let restUweSort = $state<'course' | 'demand' | 'conflict'>('course');
	let restDemandedUWEs = $derived.by(() => {
		const rest = rankedDemand.slice(3);
		if (restUweSort === 'course') return rest.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
		if (restUweSort === 'conflict') return rest.sort(byLeastConflict);
		return rest.sort((a, b) => b.priorityScore - a.priorityScore);
	});

	// Swap the overlay's top 3 for the new ranking's, leaving everything else as toggled
	function setTopUweMode(mode: 'demand' | 'conflict') {
		if (topUweMode === mode) return;
		const next = new Set(enabledCourses);
		for (const code of topDemandedUWEs) if (!myCourses.some((c) => c.courseCode === code)) next.delete(code);
		topUweMode = mode;
		for (const code of topDemandedUWEs) next.add(code);
		enabledCourses = next;
	}

	// The top 3 demanded UWEs start on the overlay, once demand AND courses have loaded
	// (the least-conflict ranking needs the course data)
	let seededTopUwes = false;
	$effect(() => {
		if (seededTopUwes || !topDemandedUWEs.length || !courses.length) return;
		seededTopUwes = true;
		enabledCourses = new Set([...enabledCourses, ...topDemandedUWEs]);
	});

	// Overlay course rows — every weekly slot of every enabled tracked course
	let overlayCourses = $derived.by(() => {
		const result: Course[] = [];
		for (const code of enabledCourses) result.push(...(rowsByBase.get(code.toUpperCase()) ?? []));
		return result;
	});

	// Calendar — combined batch courses + tracked-course overlays
	const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
	// originalDay = XLSX source day (used as override key); day = current rendered day (after override)
	type CalBlock = { course: Course; day: string; originalDay: string; startMin: number; endMin: number; isUWE: boolean };

	let calendarBlocks = $derived.by(() => {
		const blocks: CalBlock[] = [];
		const seen = new Set<string>();

		function add(c: Course, isUWE: boolean) {
			const course = moved(c);
			// A tracked course that is also one of the batch's own classes is drawn once
			const blockKey = `${course.courseCode}|${course.day}|${course.startMin}|${course.endMin}`;
			if (seen.has(blockKey)) return;
			seen.add(blockKey);
			blocks.push({ course, day: course.day!, originalDay: c.key.slice(c.key.lastIndexOf('|') + 1), startMin: course.startMin, endMin: course.endMin, isUWE });
		}

		for (const c of crBatchCourses) add(c, false);
		for (const c of overlayCourses) add(c, true);
		return blocks;
	});

	// Dept filter for the CR timetable grid
	let ttDeptFilter = $state('');
	let ttDepts = $derived([...new Set(crBatchCourses.map((c) => deptPrefix(c.courseCode)))].sort());
	let filteredCalendarBlocks = $derived.by(() =>
		ttDeptFilter ? calendarBlocks.filter((b) => deptPrefix(b.course.courseCode) === ttDeptFilter) : calendarBlocks
	);

	// What each grid cell draws, looked up by cell instead of filtered out of the full
	// list once per cell (and once more per block for the overlay stacks).
	let calendarCells = $derived(groupByCell(filteredCalendarBlocks));
	// Tracked-course blocks sharing an exact slot stack into one cyclable block
	let uweGroups = $derived.by(() => {
		const map = new Map<string, CalBlock[]>();
		for (const b of filteredCalendarBlocks) {
			if (!b.isUWE) continue;
			const key = `${b.day}|${b.startMin}|${b.endMin}`;
			const list = map.get(key);
			if (list) list.push(b);
			else map.set(key, [b]);
		}
		return map;
	});
	// Off-the-hour start times, per hour row, for the small labels in the time gutter
	let blockStartsByHour = $derived.by(() => {
		const map = new Map<number, Set<number>>();
		for (const b of filteredCalendarBlocks) {
			if (b.startMin % 60 === 0) continue;
			const hour = cellHour(b.startMin);
			const set = map.get(hour);
			if (set) set.add(b.startMin);
			else map.set(hour, new Set([b.startMin]));
		}
		return new Map([...map].map(([hour, set]) => [hour, [...set].sort((a, b) => a - b)]));
	});

	// Time range stays based on unfiltered blocks so the axis doesn't jump when filtering
	let minT = $derived(calendarBlocks.length ? Math.min(...calendarBlocks.map((b) => b.startMin)) : 480);
	let maxT = $derived(calendarBlocks.length ? Math.max(...calendarBlocks.map((b) => b.endMin)) : 1080);
	let rMin = $derived(Math.floor(minT / 60) * 60);
	let rMax = $derived(Math.ceil(maxT / 60) * 60);
	// Displayed range with user-controlled extension
	let tDispMin = $derived(Math.max(0, rMin - extraHoursBefore * 60));
	let tDispMax = $derived(Math.min(1440, rMax + extraHoursAfter * 60));
	let totalMin = $derived(tDispMax - tDispMin);
	let timeLabels = $derived(Array.from({ length: Math.floor(totalMin / 60) + 1 }, (_, i) => ({ mins: tDispMin + i * 60, label: minutesToTime(tDispMin + i * 60) })));

	// A block violates a constraint when its own professor is flagged unavailable on the same
	// day and time. Faculty cells may list multiple profs with bracketed IDs, so normalize first.
	function blockConstraintViolation(course: Course, day: string, startMin: number, endMin: number): string | null {
		const profs = normalizeFaculty(course.faculty || '').map((p) => p.toUpperCase());
		if (!profs.length) return null;
		for (const c of constraints) {
			if (c.day !== day) continue;
			if (!profs.includes(c.professorName.toUpperCase())) continue;
			if (c.allDay) return c.professorName;
			if (c.startTime && c.endTime) {
				const cs = timeToMinutes(c.startTime), ce = timeToMinutes(c.endTime);
				if (startMin < ce && cs < endMin) return c.professorName;
			}
		}
		return null;
	}

	// ---------- Loading + live sync ----------
	// Everything per-user arrives with the page (see +page.server.ts); only the course
	// catalogue is fetched, and that is an ETag'd, browser-cached response.
	$effect(() => {
		fetch('/api/timetable')
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((d) => { courses = d.courses ?? []; })
			.catch(() => showToast('could not load the timetable — refresh to retry'))
			.finally(() => (loadingCourses = false));
		if (!canManage) return;
		fetch('/api/cr/demand')
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((d) => { demand = d.demand ?? []; minorDemand = d.minorDemand ?? []; totalStudents = d.totalStudents ?? 0; })
			.catch(() => showToast('could not load student demand — refresh to retry'))
			.finally(() => (loadingCR = false));
	});

	// A poller that revalidates: it echoes the last ETag, and the server answers an empty
	// 304 until something actually changed — so an idle grid costs a few bytes per tick and
	// re-renders nothing. Returns null for "unchanged" or any failure.
	function revalidator<T>(url: string) {
		let etag = '';
		return async (): Promise<T | null> => {
			try {
				const r = await fetch(url, { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
				if (!r.ok) return null; // 304 included
				etag = r.headers.get('ETag') ?? '';
				return (await r.json()) as T;
			} catch {
				return null; // offline or signed out — the next tick retries
			}
		};
	}

	// Run `tick` every `ms` while the page is actually visible, and once immediately on
	// start and whenever the tab comes back — a backgrounded tab polls nothing.
	function pollWhileVisible(tick: () => void, ms: number) {
		let timer: ReturnType<typeof setInterval> | undefined;
		const start = () => {
			if (timer || document.visibilityState !== 'visible') return;
			tick();
			timer = setInterval(tick, ms);
		};
		const stop = () => { clearInterval(timer); timer = undefined; };
		const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
		document.addEventListener('visibilitychange', onVisibility);
		start();
		return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
	}

	// Bumped by every local change to scheduleOverrides. A poll that was already in flight
	// when the change happened is answering a question about the past — drop it.
	let localEdits = 0;
	const pollSchedule = revalidator<{ blocks: Parameters<typeof buildOverrideMapFromArray>[0] }>('/api/cr/schedule');

	async function fetchOverrides() {
		if (syncStatus === 'saving') return;
		const editsBefore = localEdits;
		const d = await pollSchedule();
		if (editsBefore !== localEdits || (syncStatus as string) === 'saving') return;
		lastSyncedAt = Date.now();
		if (d) scheduleOverrides = buildOverrideMapFromArray(d.blocks ?? []);
	}

	// Live sync while the timetable tab is open
	$effect(() => {
		if (activeTab !== 'timetable' || !canManage) return;
		return pollWhileVisible(fetchOverrides, 5000);
	});

	// Poll notifications on every tab — a CR needs to hear about someone else's move
	// while they're on the courses list, not only while staring at the grid.
	type ServerNotification = { id: string; fromUserName: string; courseCode: string; message: string; createdAt: string };
	const pollNotifications = revalidator<{ notifications: ServerNotification[] }>('/api/notifications');

	$effect(() => {
		if (!canManage) return;
		return pollWhileVisible(fetchNotifications, 20000);
	});

	async function fetchNotifications() {
		const d = await pollNotifications();
		if (!d) return;
		const rows = (d.notifications ?? [])
			.filter((n) => !dismissedIds.has(n.id))
			.map((n) => ({ ...n, createdAt: new Date(n.createdAt).getTime() }));

		const fresh = rows.filter((n) => !knownNotifIds.has(n.id));
		notifications = rows;
		for (const n of rows) knownNotifIds.add(n.id);
		if (fresh.length) {
			showToast(
				fresh.length === 1
					? `${fresh[0].courseCode} was moved by ${fresh[0].fromUserName}`
					: `${fresh.length} classes were moved by other CRs`
			);
		}
	}

	// Overlay overlap cycling: key = "day|startMin|endMin"
	let uweGroupActive = $state(new Map<string, number>());
	function cycleUwe(key: string, total: number, e: MouseEvent) {
		e.stopPropagation();
		const cur = uweGroupActive.get(key) ?? 0;
		uweGroupActive = new Map(uweGroupActive).set(key, (cur + 1) % total);
	}

	// Constraint management
	async function addConstraint() {
		if (!profName.trim()) return;
		savingConstraint = true;
		const res = await fetch('/api/cr/constraints', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ professorName: profName.trim(), day: constraintDay, allDay, startTime: allDay ? null : cStartTime, endTime: allDay ? null : cEndTime, reason: cReason.trim() || null })
		});
		if (res.ok) { const d = await res.json(); constraints = [...constraints, d.constraint]; profName = ''; cReason = ''; }
		else showToast(allDay || cStartTime < cEndTime ? 'could not add constraint' : 'the end time must be after the start');
		savingConstraint = false;
	}

	async function removeConstraint(id: number) {
		const prev = constraints;
		constraints = constraints.filter((c) => c.id !== id);
		const res = await fetch('/api/cr/constraints', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null);
		if (!res?.ok) { constraints = prev; showToast('could not remove constraint'); }
	}

	// Drag and drop (5-minute snap, top-of-block anchor)
	const CELL_H = 56;
	const SNAP = 5;
	let lastDragUpdate = 0;

	function snapMin(rawMin: number): number {
		return Math.round(rawMin / SNAP) * SNAP;
	}

	function onDragStart(e: DragEvent, course: Course, originalDay: string, isUWE: boolean) {
		dragCourse = course;
		dragOriginalDay = originalDay;
		dragIsOverlay = isUWE;
		dragOffsetY = e.offsetY;
	}

	function onTouchStart(e: TouchEvent, course: Course, originalDay: string, isUWE: boolean) {
		if (isUWE) return;
		const touch = e.touches[0];
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		touchDragCourse = course;
		touchDragOriginalDay = originalDay;
		touchDragIsOverlay = isUWE;
		touchDragOffsetX = touch.clientX - rect.left;
		touchDragOffsetY = touch.clientY - rect.top;
		touchX = touch.clientX;
		touchY = touch.clientY;
		touchGhostW = rect.width;
		touchGhostH = rect.height;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!touchDragCourse) return;
		e.preventDefault();
		const touch = e.touches[0];
		touchX = touch.clientX;
		touchY = touch.clientY;

		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		const cell = el?.closest('[data-day][data-hstart]') as HTMLElement | null;
		if (cell) {
			const day = cell.dataset.day!;
			const hStart = parseInt(cell.dataset.hstart!);
			const rect = cell.getBoundingClientRect();
			const topY = (touch.clientY - rect.top) - touchDragOffsetY;
			const newMin = snapMin(hStart + (topY / CELL_H) * 60);
			if (dragOverSlot?.day !== day || dragOverSlot?.startMin !== newMin) {
				dragOverSlot = { day, startMin: newMin };
			}
		} else {
			dragOverSlot = null;
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!touchDragCourse) return;
		const touch = e.changedTouches[0];
		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		const cell = el?.closest('[data-day][data-hstart]') as HTMLElement | null;

		const course = touchDragCourse;
		const origDay = touchDragOriginalDay;
		const isUWE = touchDragIsOverlay;
		touchDragCourse = null;
		touchDragOriginalDay = '';
		touchDragIsOverlay = false;
		dragOverSlot = null;

		if (!cell) return;
		const day = cell.dataset.day!;
		const hStart = parseInt(cell.dataset.hstart!);
		const rect = cell.getBoundingClientRect();
		const topY = (touch.clientY - rect.top) - touchDragOffsetY;
		const dropMin = snapMin(hStart + (topY / CELL_H) * 60);

		requestDrop(course, origDay, isUWE, day, dropMin);
	}

	// Shared tail of a mouse or touch drop: validate the target, warn if other CRs are
	// tracking the class or students ranked it highly, then save.
	function requestDrop(course: Course, origDay: string, isUWE: boolean, day: string, dropMin: number) {
		const dur = course.endMin - course.startMin;
		if (dropMin < 0 || dropMin + dur >= 1440) return; // dragged off the top or bottom of the day
		const blockedBy = blockConstraintViolation(course, day, dropMin, dropMin + dur);
		if (blockedBy) { showToast(`Prof. ${blockedBy} is unavailable then`); return; }

		const pending: PendingDrop = { course, origDay, day, newStart: minutesToTime(dropMin), newEnd: minutesToTime(dropMin + dur) };
		const watchers = isUWE ? 0 : (watchCounts.get(course.base) ?? 0);
		const students = isUWE ? 0 : (globalTop5.find((c) => c.code === course.base)?.total ?? 0);
		if (watchers || students) {
			moveWarnModal = { courseCode: course.base, watchers, students, pending }; // wait for confirm/cancel
			return;
		}
		applyDrop(course, origDay, day, pending.newStart, pending.newEnd);
	}

	$effect(() => {
		if (!browser) return;
		window.addEventListener('touchmove', handleTouchMove, { passive: false });
		window.addEventListener('touchend', handleTouchEnd);
		return () => {
			window.removeEventListener('touchmove', handleTouchMove);
			window.removeEventListener('touchend', handleTouchEnd);
		};
	});

	function onDragOver(e: DragEvent, day: string, hStart: number) {
		e.preventDefault();
		// Throttle state updates to ~30fps to prevent lag
		const now = performance.now();
		if (now - lastDragUpdate < 33) return;
		lastDragUpdate = now;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const topY = (e.clientY - rect.top) - dragOffsetY;
		const newMin = snapMin(hStart + (topY / CELL_H) * 60);
		// Only update state if the snap position actually changed
		if (dragOverSlot?.day === day && dragOverSlot?.startMin === newMin) return;
		dragOverSlot = { day, startMin: newMin };
	}

	function onDrop(e: DragEvent, day: string, hStart: number) {
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const topY = (e.clientY - rect.top) - dragOffsetY;
		const dropMin = snapMin(hStart + (topY / CELL_H) * 60);
		dragOverSlot = null;
		if (!dragCourse) return;

		const course = dragCourse;
		const origDay = dragOriginalDay;
		const isUWE = dragIsOverlay;
		dragCourse = null;
		dragOriginalDay = '';
		dragIsOverlay = false;
		requestDrop(course, origDay, isUWE, day, dropMin);
	}

	function cancelDrop() { moveWarnModal = null; }

	async function confirmDrop() {
		if (!moveWarnModal) return;
		const { course, origDay, day, newStart, newEnd } = moveWarnModal.pending;
		moveWarnModal = null;
		await applyDrop(course, origDay, day, newStart, newEnd);
	}

	async function dismissNotification(id: string) {
		dismissedIds.add(id);
		notifications = notifications.filter((n) => n.id !== id);
		fetch('/api/notifications', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		}).catch(() => { /* still hidden locally; it returns on the next visit if this failed */ });
	}

	function setOverride(key: string, pos: MovePos | null) {
		localEdits++;
		const m = new Map(scheduleOverrides);
		if (pos) m.set(key, { ...pos, startMin: timeToMinutes(pos.startTime), endMin: timeToMinutes(pos.endTime) });
		else m.delete(key);
		scheduleOverrides = m;
	}

	// One timer for the status pill, so an old "saved ✓" fading out can never flip the
	// status back to idle in the middle of a newer save.
	let syncTimer: ReturnType<typeof setTimeout>;
	function settle(status: 'saved' | 'error') {
		syncStatus = status;
		if (status === 'saved') lastSyncedAt = Date.now();
		clearTimeout(syncTimer);
		syncTimer = setTimeout(() => (syncStatus = 'idle'), status === 'saved' ? 2500 : 3000);
	}

	// Every write to the shared schedule goes through here. The server decides the rest
	// (class length, who gets notified, whether the caller may move it at all) — the
	// client only names the slot and where it should start.
	async function sendSchedule(method: 'POST' | 'DELETE', body: Record<string, unknown>): Promise<boolean> {
		clearTimeout(syncTimer);
		syncStatus = 'saving';
		try {
			const res = await fetch('/api/cr/schedule', {
				method,
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) { settle('saved'); return true; }
			const reason = (await res.json().catch(() => null))?.message;
			if (reason) showToast(reason);
		} catch { /* network error — reported as a failed sync below */ }
		settle('error');
		return false;
	}

	/** Save a slot's position, or with `pos: null` put it back where the sheet has it */
	function saveSlot(course: Course, origDay: string, pos: MovePos | null): Promise<boolean> {
		const slot = { courseCode: course.courseCode, component: course.component ?? '', originalDay: origDay };
		return pos
			? sendSchedule('POST', { ...slot, day: pos.day, startTime: pos.startTime })
			: sendSchedule('DELETE', slot);
	}

	async function applyDrop(course: Course, origDay: string, day: string, newStart: string, newEnd: string) {
		const overrideKey = `${course.courseCode}|${course.component ?? ''}|${origDay}`;
		const before: MovePos | null = scheduleOverrides.get(overrideKey) ?? null;
		const after: MovePos = { day, startTime: newStart, endTime: newEnd };

		// Optimistic update — apply immediately so UI moves before API responds
		setOverride(overrideKey, after);
		if (await saveSlot(course, origDay, after)) {
			undoStack = [...undoStack, { key: overrideKey, course, origDay, before, after }].slice(-3);
			redoStack = [];
		} else {
			setOverride(overrideKey, before);
		}
	}

	async function undoMove() {
		if (syncStatus === 'saving' || !undoStack.length) return;
		const entry = undoStack[undoStack.length - 1];
		undoStack = undoStack.slice(0, -1);
		setOverride(entry.key, entry.before);
		if (await saveSlot(entry.course, entry.origDay, entry.before)) {
			redoStack = [...redoStack, entry].slice(-3);
		} else {
			setOverride(entry.key, entry.after);
			undoStack = [...undoStack, entry];
		}
	}

	async function redoMove() {
		if (syncStatus === 'saving' || !redoStack.length) return;
		const entry = redoStack[redoStack.length - 1];
		redoStack = redoStack.slice(0, -1);
		setOverride(entry.key, entry.after);
		if (await saveSlot(entry.course, entry.origDay, entry.after)) {
			undoStack = [...undoStack, entry].slice(-3);
		} else {
			setOverride(entry.key, entry.before);
			redoStack = [...redoStack, entry];
		}
	}

	// Reset puts back every move this CR could have made — their own batches' classes.
	// Other batches' moves belong to those CRs and stay (admins reset everything).
	async function resetPositions() {
		const prev = scheduleOverrides;
		const mine = new Set(crBatchNames);
		localEdits++;
		scheduleOverrides = isAdmin
			? new Map()
			: new Map([...prev].filter(([key]) => !slotsByKey.get(key)?.batches.some((b) => mine.has(b))));
		if (await sendSchedule('DELETE', { all: true })) {
			undoStack = [];
			redoStack = [];
		} else {
			localEdits++;
			scheduleOverrides = prev;
		}
	}

	const tColors: Record<string, string> = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };
	const DAY_LIST = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
</script>

<!-- Touch drag ghost (mobile only) -->
{#if touchDragCourse}
	<div style="position: fixed; left: {touchX - touchDragOffsetX}px; top: {touchY - touchDragOffsetY}px; width: {touchGhostW}px; height: {touchGhostH}px; pointer-events: none; z-index: 9999; opacity: 0.85; background: var(--block); border: 1px solid var(--accent); padding: 2px 4px; overflow: hidden;">
		<div class="text-[10px] font-medium truncate" style="color: var(--fg);">{touchDragCourse.base}</div>
		<div class="text-[9px] truncate" style="color: var(--muted);">{touchDragCourse.courseName}</div>
	</div>
{/if}

{#snippet notificationList()}
	{#if notifications.length > 0}
		<div class="flex flex-col gap-2">
			{#each notifications as notif (notif.id)}
				<div class="card flex items-start justify-between gap-3 px-4 py-3" style="border-left: 3px solid var(--accent);">
					<div class="flex flex-col gap-0.5">
						<p class="text-sm" style="color: var(--fg);">{notif.message}</p>
						<p class="eyebrow" style="font-size: 0.58rem;">{browser ? relativeTime(notif.createdAt) : ''}</p>
					</div>
					<button onclick={() => dismissNotification(notif.id)} class="linkbtn shrink-0">dismiss</button>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<div class="flex min-h-dvh flex-col" style="background: var(--bg);">
	<!-- Header -->
	<header class="flex items-center justify-between gap-3 px-4 py-3 md:px-8 md:py-4" style="border-bottom: 1px solid var(--border);">
		<div class="flex items-center gap-2.5">
			<span class="grid h-7 w-7 place-items-center rounded-md" style="background: var(--accent); color: var(--on-accent); font-family: var(--font-serif); font-weight: 700; font-size: 1.25rem; line-height: 1;">n</span>
			<span class="title-md" style="font-size: 1.35rem;">noodle</span>
			<span class="badge ml-1 hidden sm:inline-flex">{isAdmin ? 'admin' : data.user.role}</span>
		</div>
		<div class="flex items-center gap-2 md:gap-3">
			{#if canManage}
				<button onclick={() => { viewAsStudent = !viewAsStudent; activeTab = viewAsStudent ? 'preferences' : 'demand'; }}
					class="btn btn-ghost btn-sm" title="Switch between student and CR views">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>
					<span class="hidden sm:inline">{viewAsStudent ? 'CR view' : 'Student view'}</span>
				</button>
			{/if}
			{#if isAdmin}
				<a href="/admin" class="linkbtn hidden sm:inline">admin</a>
			{/if}
			<span class="hidden max-w-[14rem] truncate text-xs md:inline" style="color: var(--muted);">{data.user.email}</span>
			<button onclick={toggleTheme} title="Toggle light / dark" aria-label="Toggle theme"
				class="grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors duration-200"
				style="border-color: var(--border); color: var(--muted); background: transparent;"
				onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
				onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
			><span style="font-size: 0.95rem; line-height: 1;">{theme === 'light' ? '☾' : '☀'}</span></button>
			<form method="POST" action="/auth/signout" class="contents">
				<button type="submit" class="btn btn-ghost btn-sm">sign out</button>
			</form>
		</div>
	</header>

	<!-- Tabs -->
	<nav class="flex gap-5 overflow-x-auto px-4 md:gap-7 md:px-8" style="border-bottom: 1px solid var(--border);">
		{#if viewAsStudent}
			<button onclick={() => activeTab = 'preferences'} class="tab {activeTab === 'preferences' ? 'tab-active' : ''}">preferences</button>
			<button onclick={() => activeTab = 'mytimetable'} class="tab {activeTab === 'mytimetable' ? 'tab-active' : ''}">my timetable</button>
		{:else}
			<button onclick={() => activeTab = 'demand'} class="tab {activeTab === 'demand' ? 'tab-active' : ''}">demand{#if notifications.length > 0}<span class="absolute -right-2.5 top-2.5 h-1.5 w-1.5 rounded-full" style="background: var(--accent);"></span>{/if}</button>
			<button onclick={() => activeTab = 'courses'} class="tab {activeTab === 'courses' ? 'tab-active' : ''}">courses</button>
			<button onclick={() => activeTab = 'timetable'} class="tab {activeTab === 'timetable' ? 'tab-active' : ''}">timetable</button>
			<button onclick={() => activeTab = 'settings'} class="tab {activeTab === 'settings' ? 'tab-active' : ''}">constraints</button>
			<button onclick={() => activeTab = 'mytimetable'} class="tab {activeTab === 'mytimetable' ? 'tab-active' : ''}">browse batch</button>
		{/if}
	</nav>

	<!-- Content -->
	<main class="flex-1 px-4 py-8 md:px-8 md:py-12">

		<!-- ==================== STUDENT: PREFERENCES ==================== -->
		{#if activeTab === 'preferences'}
			<div class="animate-in mx-auto flex w-full max-w-5xl flex-col gap-6">
				<div class="flex flex-col gap-1.5">
					<h1 class="title-xl">Your preferences</h1>
					<p class="hint">Tell us your batch and the electives you'd like — your class rep uses this to build the timetable.</p>
				</div>

				<div class="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:gap-y-6">
				<div class="flex min-w-0 flex-col gap-5">
				<!-- Profile strip -->
				<div class="flex items-center gap-3 rounded-xl border px-3 py-2.5" style="border-color: var(--border); background: var(--surface);">
					<div class="grid h-10 w-10 shrink-0 place-items-center rounded-full" style="background: var(--accent); color: var(--on-accent); font-family: var(--font-serif); font-weight: 700; font-size: 1.2rem;">{(data.user.name ?? '?').charAt(0).toUpperCase()}</div>
					<div class="min-w-0 flex-1">
						<p class="truncate font-semibold" style="color: var(--fg);">{data.user.name}</p>
						<p class="truncate text-sm" style="color: var(--muted);">{data.user.email}</p>
					</div>
					<span class="badge">{data.user.role}</span>
				</div>

				<!-- Step 1: batch -->
				<div class="card flex flex-col {editingBatch || !studentBatch ? 'card-pad gap-4' : 'px-5 py-4'}">
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
						<span class="step-num">1</span>
						<h2 class="title-md">Your batch</h2>
						{#if !editingBatch && studentBatch}
							<div class="flex flex-wrap gap-1.5">
								{#each studentBatch.split(',').map(b => b.trim()).filter(Boolean) as b}
									<span class="badge" style="color: var(--fg); font-size: 0.7rem;">{b}</span>
								{/each}
							</div>
						{/if}
						<div class="flex-1"></div>
						{#if !studentBatch}
							<span class="badge" style="color: #d8593f; border-color: color-mix(in srgb, #d8593f 45%, var(--border));">required</span>
						{:else if !editingBatch}
							<button onclick={() => editingBatch = true} class="linkbtn">edit</button>
						{/if}
					</div>

					{#if editingBatch || !studentBatch}
						<div class="flex flex-col gap-3">
							<p class="hint">Add every batch code you belong to — e.g. ECE 2nd years have both <span style="color: var(--fg); font-weight: 600;">ELC2X</span> and <span style="color: var(--fg); font-weight: 600;">ELC2YR</span>.</p>
							{#each batchInputs as input, i}
								{@const isValid = allBatches.includes(batchInputs[i].trim().toUpperCase())}
								<div class="relative flex items-center gap-2">
									<div class="relative flex-1">
										<input
											type="text"
											bind:value={batchInputs[i]}
											oninput={() => onBatchInput(i)}
											onfocus={() => onBatchInput(i)}
											onblur={() => setTimeout(() => { batchSuggestions[i] = []; batchSuggestions = [...batchSuggestions]; }, 150)}
											placeholder="e.g. ELC21"
											autocomplete="off"
											class="input uppercase"
											style={isValid ? 'border-color: #22c55e; padding-right: 2.2rem;' : ''}
										/>
										{#if isValid}
											<svg class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
										{/if}
									</div>
									{#if batchInputs.length > 1}
										<button onclick={() => removeBatchInput(i)} aria-label="Remove batch"
											class="grid h-9 w-9 shrink-0 place-items-center rounded-md border transition-colors duration-150"
											style="border-color: var(--border); color: var(--muted);"
											onmouseenter={(e) => { e.currentTarget.style.color = '#d8593f'; e.currentTarget.style.borderColor = '#d8593f'; }}
											onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
										>&times;</button>
									{/if}
									{#if batchSuggestions[i]?.length}
										<div class="card absolute left-0 top-full z-10 mt-1 max-h-44 w-full overflow-y-auto p-1"
											style="box-shadow: var(--shadow-lg);">
											{#each batchSuggestions[i] as suggestion}
												<button
													onmousedown={() => selectBatchSuggestion(i, suggestion)}
													ontouchstart={() => selectBatchSuggestion(i, suggestion)}
													class="block w-full cursor-pointer rounded-md border-none bg-transparent px-3 py-2.5 text-left text-sm uppercase transition-colors duration-100"
													style="color: var(--muted);"
													onmouseenter={(e) => { e.currentTarget.style.background = 'var(--tint)'; e.currentTarget.style.color = 'var(--fg)'; }}
													onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
												>{suggestion}</button>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
							<div class="mt-1 flex items-center gap-3">
								{#if batchInputs.length < 4}
									<button onclick={addBatchInput} class="linkbtn">+ add another batch</button>
								{/if}
								<div class="flex-1"></div>
								{#if studentBatch && editingBatch}
									<button onclick={() => { editingBatch = false; batchInputs = studentBatch.split(',').map(b => b.trim()).filter(Boolean); batchSuggestions = batchInputs.map(() => []); }}
										class="btn btn-ghost btn-sm">cancel</button>
								{/if}
								<button onclick={saveBatch} disabled={batchSubmitting} class="btn btn-primary btn-sm">{batchSubmitting ? 'saving…' : 'save batch'}</button>
							</div>
							{#if batchError}<p class="flex items-center gap-2 text-sm" style="color: var(--danger);"><span>⚠</span>{batchError}</p>{/if}
						</div>
					{/if}
				</div>

				<!-- helper tip -->
				<div class="card flex items-start gap-2.5 px-4 py-3.5">
					<svg width="16" height="16" class="mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>
					<p class="hint" style="font-size: 0.8rem;">You can update these any time until your class rep locks preferences. Rank by genuine interest — it helps your CR resolve clashes.</p>
				</div>
				</div>
				<div class="flex min-w-0 flex-col gap-5">
				<!-- Step 2: course preferences — gated behind batch -->
				{#if !studentBatch}
					<div class="card card-pad flex items-center gap-3" style="border-style: dashed;">
						<svg width="20" height="20" class="shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
						<p class="hint">Save your batch above to unlock course preferences.</p>
					</div>
				{:else}
					<div class="card card-pad flex flex-col gap-5">
						<div class="flex items-center gap-3">
							<span class="step-num">2</span>
							<div class="min-w-0 flex-1"><h2 class="title-md">Course preferences</h2></div>
							{#if locked}<span class="badge">🔒 locked</span>{/if}
						</div>

						{#if loadingCourses}
							<p class="hint animate-pulse">Loading courses…</p>
						{:else}
							<div class="flex flex-col">
								<label for="pref-minor" class="field-label">Minor <span style="color: var(--muted); font-weight: 400;">· optional</span></label>
								<select id="pref-minor" bind:value={minor} disabled={locked}
									class="select disabled:opacity-40">
									<option value="">— none —</option>
									{#each minorPrograms as p}<option value={p}>{p}</option>{/each}
								</select>
							</div>

							<label class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors {locked ? 'opacity-40' : ''}" style="border-color: {minorOnly ? 'var(--accent)' : 'var(--border)'}; background: {minorOnly ? 'var(--tint)' : 'transparent'};">
								<input type="checkbox" checked={minorOnly} disabled={locked} style="accent-color: var(--accent); width: 1.05rem; height: 1.05rem;"
									onchange={(e) => { minorOnly = e.currentTarget.checked; if (minorOnly) { uwePref1 = ''; uwePref2 = ''; uwePref3 = ''; } }} />
								<span class="text-sm" style="color: var(--fg);">Minor only — I don't want a UWE elective</span>
							</label>

							{#if !minorOnly}
								<div class="flex flex-col gap-3">
									<div class="flex items-baseline justify-between gap-3">
										<span class="field-label" style="margin: 0;">Rank your electives</span>
										<span class="eyebrow" style="font-size: 0.58rem;">1 = most wanted</span>
									</div>
									{#each [{ v: uwePref1, s: (x: string) => uwePref1 = x }, { v: uwePref2, s: (x: string) => uwePref2 = x }, { v: uwePref3, s: (x: string) => uwePref3 = x }] as pref, i}
										<div class="flex items-center gap-3">
											<span class="rank-num">{i + 1}</span>
											<select aria-label="Elective choice {i + 1}" value={pref.v} onchange={(e) => pref.s(e.currentTarget.value)} disabled={locked}
												class="select flex-1 disabled:opacity-40">
												<option value="">{i === 0 ? '— first choice —' : i === 1 ? '— second choice —' : '— third choice —'}</option>
												{#each uweCourseOptions as c}<option value={c.base}>{c.base} — {c.courseName}</option>{/each}
											</select>
										</div>
									{/each}
								</div>
							{/if}

							{#if prefError}<p class="flex items-center gap-2 text-sm" style="color: #d8593f;"><span>⚠</span>{prefError}</p>{/if}
							{#if prefSuccess}<p class="flex items-center gap-2 text-sm" style="color: #3fa463;"><span>✓</span>{prefSuccess}</p>{/if}

							{#if !locked}
								<button onclick={submitPreferences} disabled={submitting} class="btn btn-primary btn-block" style="padding-top: 0.85rem; padding-bottom: 0.85rem;">{submitting ? 'saving…' : data.preference ? 'update preferences' : 'submit preferences'}</button>
							{:else}
								<p class="hint">Editing is locked by your class rep.</p>
							{/if}
						{/if}
					</div>
				{/if}
				</div>
				</div>
			</div>

		<!-- ==================== CR: DEMAND ==================== -->
		{:else if activeTab === 'demand'}
			<div class="animate-in mx-auto flex w-full max-w-5xl flex-col gap-6">
				{@render notificationList()}
				<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
					<div class="flex flex-col gap-1">
						<h1 class="title-xl">Elective demand</h1>
						<p class="hint">Electives students want, and whether each clashes with your batch timetable. <span style="color: var(--fg); font-weight: 600;">{totalStudents}</span> submitted.</p>
					</div>
					<button onclick={toggleLockAll} disabled={lockSubmitting} class="btn btn-sm {locked ? 'btn-danger' : 'btn-ghost'}">
						{#if locked}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
						{/if}
						{lockSubmitting ? (locked ? 'unlocking…' : 'locking…') : (locked ? 'unlock editing' : 'lock preferences')}
					</button>
				</div>

				{#if loadingCR}
					<p class="text-xs animate-pulse" style="color: var(--muted);">loading...</p>
				{:else}
					<!-- Filter chips — horizontally scrollable so 20+ depts stay tidy -->
					{#if demandDepts.length > 1}
						<div class="flex gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: none;">
							<button onclick={() => deptFilter = ''}
								class="cursor-pointer shrink-0 border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
								style="border-color: {!deptFilter ? 'var(--muted)' : 'var(--border)'}; color: {!deptFilter ? 'var(--fg)' : 'var(--muted)'}; background: transparent;"
							>all</button>
							{#each demandDepts as dept}
								<button onclick={() => deptFilter = deptFilter === dept ? '' : dept}
									class="cursor-pointer shrink-0 border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
									style="border-color: {deptFilter === dept ? 'var(--accent)' : 'var(--border)'}; color: {deptFilter === dept ? 'var(--accent)' : 'var(--muted)'}; background: {deptFilter === dept ? 'var(--tint)' : 'transparent'};"
								>{dept}</button>
							{/each}
						</div>
					{/if}

					<div class="card nood-mono overflow-x-auto">
						<table class="w-full min-w-[540px] text-left text-sm" style="border-collapse: collapse;">
							<thead>
								<tr style="border-bottom: 1px solid var(--border);">
									<th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted);">course</th>
									<th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted);">p1/p2/p3</th>
									<th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
										style="color: {demandSort === 'score' ? 'var(--accent)' : 'var(--muted)'};"
										onclick={() => { if (demandSort === 'score') demandSortDir = demandSortDir === 'desc' ? 'asc' : 'desc'; else { demandSort = 'score'; demandSortDir = 'desc'; } }}
									>score <span style="display: inline-block; width: 0.75em; text-align: center;">{demandSort === 'score' ? (demandSortDir === 'desc' ? '↓' : '↑') : ''}</span></th>
									<th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
										style="color: {demandSort === 'total' ? 'var(--accent)' : 'var(--muted)'};"
										onclick={() => { if (demandSort === 'total') demandSortDir = demandSortDir === 'desc' ? 'asc' : 'desc'; else { demandSort = 'total'; demandSortDir = 'desc'; } }}
									>interested <span style="display: inline-block; width: 0.75em; text-align: center;">{demandSort === 'total' ? (demandSortDir === 'desc' ? '↓' : '↑') : ''}</span></th>
									<th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
										style="color: {demandSort === 'conflict' ? 'var(--accent)' : 'var(--muted)'};"
										onclick={() => { if (demandSort === 'conflict') demandSortDir = demandSortDir === 'desc' ? 'asc' : 'desc'; else { demandSort = 'conflict'; demandSortDir = 'asc'; } }}
									>conflicts <span style="display: inline-block; width: 0.75em; text-align: center;">{demandSort === 'conflict' ? (demandSortDir === 'desc' ? '↓' : '↑') : ''}</span></th>
									<th class="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style="color: var(--muted);">status</th>
								</tr>
							</thead>
							<tbody>
								{#each filteredDemand as item}
									{@const level = getTrafficLight(item.courseCode)}
									{@const adjustedLevel = adjustedConflictMap.get(item.courseCode) ?? level}
									{@const conflictCleared = level !== 'green' && adjustedLevel === 'green'}
									{@const conf = courseConflicts.get(item.courseCode)}
									{@const courseName = namesByBase.get(item.courseCode)}
									<tr style="border-bottom: 1px solid var(--border);">
										<td class="px-3 py-2.5">
											<span class="font-medium" style="color: var(--fg);">{item.courseCode}</span>
											{#if courseName}<span class="ml-2 hidden text-[9px] md:inline" style="color: var(--muted);">{courseName}</span>{/if}
										</td>
										<td class="px-3 py-2.5" style="color: var(--muted);">{item.p1}/{item.p2}/{item.p3}</td>
										<td class="px-3 py-2.5 font-medium" style="color: var(--fg);">{item.priorityScore}</td>
										<td class="px-3 py-2.5" style="color: var(--muted);">{item.total}</td>
										<td class="px-3 py-2.5 whitespace-nowrap">
											{#if conf && conf.score > 0}
												{#if conf.red > 0}<span style="color: {tColors.red};">{conf.red}R</span>{/if}
												{#if conf.red > 0 && conf.yellow > 0}<span style="color: var(--muted);"> · </span>{/if}
												{#if conf.yellow > 0}<span style="color: {tColors.yellow};">{conf.yellow}Y</span>{/if}
											{:else}
												<span class="inline-block h-2 w-2 rounded-full" style="background: {tColors.green};"></span>
											{/if}
										</td>
										<td class="px-3 py-2.5">
											<div class="flex flex-wrap items-center gap-2">
												<span class="inline-block h-2 w-2 rounded-full" style="background: {conflictCleared ? '#22c55e' : tColors[level]};"></span>
												{#if conflictCleared}
													<span class="text-[8px] uppercase tracking-[0.08em] px-1.5 py-0.5" style="color: #22c55e; border: 1px solid #22c55e44; background: #22c55e0d;">no conflict after adjustment</span>
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if !filteredDemand.length}<p class="text-center text-xs py-8" style="color: var(--muted);">{demand.length ? 'no courses match this filter' : 'no submissions yet'}</p>{/if}

					<!-- Legend -->
					<div class="flex flex-wrap gap-4 pt-3" style="border-top: 1px solid var(--border);">
						{#each [['#22c55e', 'no conflict'], ['#eab308', 'tutorial overlap'], ['#ef4444', 'lecture conflict']] as [color, label]}
							<div class="flex items-center gap-1.5">
								<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: {color};"></span>
								<span class="text-[8px] uppercase tracking-[0.1em]" style="color: var(--muted);">{label}</span>
							</div>
						{/each}
						<div class="flex items-center gap-1.5">
							<span class="text-[8px] uppercase tracking-[0.08em] px-1.5 py-0.5" style="color: #22c55e; border: 1px solid #22c55e44; background: #22c55e0d;">no conflict after adjustment</span>
							<span class="text-[8px] uppercase tracking-[0.1em]" style="color: var(--muted);">cr moved this slot</span>
						</div>
					</div>

					<!-- Minor demand -->
					<div class="flex flex-col gap-3 pt-4" style="border-top: 1px solid var(--border);">
						<h2 class="title-md">minor demand</h2>
						{#if minorDemand.length}
							<div class="flex flex-col">
								{#each minorDemand as item}
									<div class="flex items-center justify-between gap-3 px-3 py-2.5" style="border-bottom: 1px solid var(--border);">
										<span class="min-w-0 truncate text-xs" style="color: var(--fg);">{item.minor}</span>
										<span class="shrink-0 text-xs font-medium" style="color: var(--fg);">{item.count} <span class="text-[9px] font-normal uppercase tracking-[0.08em]" style="color: var(--muted);">{item.count === 1 ? 'student' : 'students'}</span></span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-xs" style="color: var(--muted);">no minor selections yet</p>
						{/if}
					</div>
				{/if}
			</div>

		<!-- ==================== CR: COURSES ==================== -->
		{:else if activeTab === 'courses'}
			<div class="animate-in mx-auto flex w-full max-w-5xl flex-col gap-6">
				{@render notificationList()}

				<!-- Title + tally on the left, one compact search field on the right -->
				<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
					<div class="flex min-w-0 flex-col gap-1.5">
						<h1 class="title-xl">Courses you're tracking</h1>
						{#if myCourses.length}
							<div class="nood-mono flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.08em]" style="color: var(--muted);">
								<span style="color: var(--fg);">{myCourses.length} tracked</span>
								{#each [[trackedSummary.clear, 'clear', tColors.green], [trackedSummary.overlap, 'tutorial overlap', tColors.yellow], [trackedSummary.clash, 'lecture clash', tColors.red]] as [n, label, color]}
									{#if n}
										<span class="flex items-center gap-1.5"><span class="inline-block h-1.5 w-1.5 rounded-full" style="background: {color};"></span>{n} {label}</span>
									{/if}
								{/each}
							</div>
						{:else}
							<p class="hint">Add the courses you care about — they overlay on your grid and flag clashes.</p>
						{/if}
					</div>

					<div class="relative w-full max-w-[19rem]">
						<input
							id="course-search"
							bind:value={search}
							oninput={() => (searchOpen = true)}
							onfocus={() => (searchOpen = true)}
							onblur={() => setTimeout(() => (searchOpen = false), 150)}
							placeholder="add a course — code or name"
							autocomplete="off"
							class="input"
						/>
						{#if searchOpen && search.trim().length >= 2}
							<div class="card absolute left-0 top-full z-20 mt-1 max-h-[22rem] w-full overflow-y-auto p-1" style="box-shadow: var(--shadow-lg);">
								{#if loadingCourses}
									<p class="hint animate-pulse px-2.5 py-2">Loading courses…</p>
								{:else if searchResults.length}
									{#each searchResults as r}
										{@const level = getTrafficLight(r.code)}
										<button
											disabled={r.watched || addingCode === r.code}
											onmousedown={() => addCourse(r.code, r.name)}
											ontouchstart={() => addCourse(r.code, r.name)}
											class="flex w-full items-center gap-2.5 rounded-md border-none bg-transparent px-2.5 py-2 text-left transition-colors duration-100 disabled:opacity-45"
											style="cursor: {r.watched ? 'default' : 'pointer'};"
											onmouseenter={(e) => { if (!r.watched) e.currentTarget.style.background = 'var(--tint)'; }}
											onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; }}
										>
											<span class="inline-block h-2 w-2 shrink-0 rounded-full" style="background: {tColors[level]};"></span>
											<span class="min-w-0 flex-1">
												<span class="nood-mono block truncate text-xs font-medium" style="color: var(--fg);">{r.code}</span>
												<span class="block truncate text-xs" style="color: var(--muted);">{r.name}</span>
											</span>
											<span class="eyebrow shrink-0" style="font-size: 0.56rem;">{r.watched ? 'added' : addingCode === r.code ? 'adding…' : '+ add'}</span>
										</button>
									{/each}
								{:else}
									<p class="hint px-2.5 py-2">Nothing matches “{search.trim()}”.</p>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				{#if !myCourses.length}
					<div class="flex flex-col items-center gap-1.5 px-4 py-16 text-center" style="border: 1px dashed var(--border); border-radius: var(--radius);">
						<p class="hint" style="color: var(--fg);">No courses tracked yet</p>
						<p class="hint">Search above — start with the electives your batch keeps asking about.</p>
					</div>
				{:else}
					<div class="flex items-center justify-between gap-3">
						<span class="eyebrow">your list</span>
						<div class="flex gap-1.5">
							{#each [['course', 'by course'], ['conflict', 'least conflict']] as [mode, label]}
								<button onclick={() => listSort = mode as 'course' | 'conflict'}
									class="chip {listSort === mode ? 'chip-active' : ''}">{label}</button>
							{/each}
						</div>
					</div>

					<!-- One row per course. The left rule carries the conflict level, so the list
					     reads as a severity column before you read a single word. -->
					<div class="flex flex-col gap-1.5">
						{#each sortedMyCourses as item}
							{@const level = getTrafficLight(item.courseCode)}
							{@const adjustedLevel = adjustedConflictMap.get(item.courseCode) ?? level}
							{@const conflictCleared = level !== 'green' && adjustedLevel === 'green'}
							{@const conf = courseConflicts.get(item.courseCode)}
							<div class="card flex items-center gap-3 px-3.5 py-2.5" style="border-left: 3px solid {tColors[adjustedLevel]};">
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
										<span class="nood-mono text-sm font-medium" style="color: var(--fg);">{item.courseCode}</span>
										{#if conflictCleared}
											<span class="badge" style="color: {tColors.green}; border-color: color-mix(in srgb, {tColors.green} 45%, var(--border)); background: color-mix(in srgb, {tColors.green} 8%, transparent);">cleared by your moves</span>
										{/if}
									</div>
									{#if item.courseName}
										<p class="truncate text-xs" style="color: var(--muted);">{item.courseName}</p>
									{/if}
								</div>
								<div class="nood-mono shrink-0 whitespace-nowrap text-xs">
									{#if conf && conf.score > 0}
										{#if conf.red > 0}<span style="color: {tColors.red};">{conf.red}R</span>{/if}{#if conf.red > 0 && conf.yellow > 0}<span style="color: var(--muted);"> · </span>{/if}{#if conf.yellow > 0}<span style="color: {tColors.yellow};">{conf.yellow}Y</span>{/if}
									{:else}
										<span class="text-[10px] uppercase tracking-[0.08em]" style="color: var(--muted);">no clash</span>
									{/if}
								</div>
								<button onclick={() => removeCourse(item.courseCode)} aria-label="Remove {item.courseCode}"
									class="shrink-0 cursor-pointer border-none bg-transparent px-1 text-base leading-none transition-colors"
									style="color: var(--muted);"
									onmouseenter={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
									onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
								>&times;</button>
							</div>
						{/each}
					</div>

					<div class="nood-mono flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[10px] uppercase tracking-[0.08em]" style="color: var(--muted);">
						<span>R = lecture clash</span>
						<span>Y = tutorial overlap</span>
						<span>counted against your selected batches</span>
					</div>
				{/if}
			</div>

		<!-- ==================== CR: TIMETABLE ==================== -->
		{:else if activeTab === 'timetable'}
			<div class="nood-mono flex flex-col gap-5">
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div class="min-w-0">
						<h2 class="text-lg font-semibold" style="color: var(--accent);">weekly schedule</h2>
						<p class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">
							{#if viewedBatchNames.length}
								{viewedBatchNames.join(', ')} ·
							{/if}
							{crBatchCourses.length} courses
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<!-- Originals toggle + reset -->
						{#if scheduleOverrides.size > 0}
							<button
								onclick={() => showOriginals = !showOriginals}
								class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] transition-all duration-150"
								style="border-color: {showOriginals ? 'var(--muted)' : 'var(--border)'}; color: {showOriginals ? 'var(--fg)' : 'var(--muted)'}; background: transparent;"
							>{showOriginals ? 'hide original' : 'show original'}</button>
							<button
								onclick={resetPositions}
								class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] transition-all duration-150"
								style="border-color: var(--border); color: var(--muted); background: transparent;"
								onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = '#e44'; (e.currentTarget as HTMLElement).style.borderColor = '#e44'; }}
								onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
							>reset positions</button>
						{/if}
						<!-- Undo / redo (session-only, last 3 moves) -->
						<button onclick={undoMove} disabled={!undoStack.length || syncStatus === 'saving'}
							class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] transition-all duration-150 disabled:cursor-default disabled:opacity-30"
							style="border-color: var(--border); color: var(--muted); background: transparent;"
							onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
							onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
						>↶ undo</button>
						<button onclick={redoMove} disabled={!redoStack.length || syncStatus === 'saving'}
							class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] transition-all duration-150 disabled:cursor-default disabled:opacity-30"
							style="border-color: var(--border); color: var(--muted); background: transparent;"
							onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
							onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
						>↷ redo</button>
						<!-- Sync status -->
						<span class="text-[9px] uppercase tracking-[0.12em] text-right" style="min-width: 5.5rem; color: {syncStatus === 'saving' ? 'var(--muted)' : syncStatus === 'saved' ? '#4e4' : syncStatus === 'error' ? '#e44' : 'var(--fg)'};">
							{#if syncStatus === 'saving'}saving…{:else if syncStatus === 'saved'}synced ✓{:else if syncStatus === 'error'}sync failed{:else if lastSyncedAt > 0}live{/if}
						</span>
					</div>
				</div>
				<!-- Time range controls -->
				<div class="flex items-center gap-3">
					<button onclick={() => extraHoursBefore = Math.min(extraHoursBefore + 1, Math.floor(tDispMin / 60))}
						class="cursor-pointer border px-2.5 py-1 text-[9px] tracking-wider transition-all duration-150"
						style="border-color: var(--border); color: var(--muted); background: transparent;"
						onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--muted)'; }}
						onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
						disabled={tDispMin <= 0}
					>↑ earlier</button>
					<span class="text-[9px]" style="color: var(--muted);">{minutesToTime(tDispMin)} — {minutesToTime(tDispMax)}</span>
					<button onclick={() => extraHoursAfter = Math.min(extraHoursAfter + 1, Math.floor((1440 - tDispMax) / 60))}
						class="cursor-pointer border px-2.5 py-1 text-[9px] tracking-wider transition-all duration-150"
						style="border-color: var(--border); color: var(--muted); background: transparent;"
						onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'var(--muted)'; }}
						onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
						disabled={tDispMax >= 1440}
					>↓ later</button>
					{#if extraHoursBefore > 0 || extraHoursAfter > 1}
						<button onclick={() => { extraHoursBefore = 0; extraHoursAfter = 1; }}
							class="cursor-pointer border-none bg-transparent text-[9px] tracking-wider transition-colors duration-150"
							style="color: var(--muted);"
							onmouseenter={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
							onmouseleave={(e) => { e.currentTarget.style.color = 'var(--border)'; }}
						>reset</button>
					{/if}
				</div>

				<!-- Batch view switcher — one batch at a time, or all together -->
				{#if crBatchNames.length > 1}
					<div class="flex items-center gap-2">
						<span class="shrink-0 text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">batch</span>
						<div class="flex gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: none;">
							<button onclick={() => batchViews = new Set()}
								class="cursor-pointer shrink-0 border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
								style="border-color: {!batchViews.size ? 'var(--accent)' : 'var(--border)'}; color: {!batchViews.size ? 'var(--accent)' : 'var(--muted)'}; background: {!batchViews.size ? 'var(--tint)' : 'transparent'};"
							>all ({crBatchNames.length})</button>
							{#each crBatchNames as bn}
								{@const on = batchViews.has(bn)}
								<button onclick={() => toggleBatchView(bn)}
									class="cursor-pointer shrink-0 border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
									style="border-color: {on ? 'var(--accent)' : 'var(--border)'}; color: {on ? 'var(--accent)' : 'var(--muted)'}; background: {on ? 'var(--tint)' : 'transparent'};"
								>{on ? '✓ ' : ''}{bn}</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Dept filter chips -->
				{#if ttDepts.length > 1}
					<div class="flex gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: none;">
						<button onclick={() => ttDeptFilter = ''}
							class="cursor-pointer shrink-0 border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
							style="border-color: {!ttDeptFilter ? 'var(--muted)' : 'var(--border)'}; color: {!ttDeptFilter ? 'var(--fg)' : 'var(--muted)'}; background: transparent;"
						>all</button>
						{#each ttDepts as dept}
							<button onclick={() => ttDeptFilter = ttDeptFilter === dept ? '' : dept}
								class="cursor-pointer shrink-0 border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
								style="border-color: {ttDeptFilter === dept ? 'var(--accent)' : 'var(--border)'}; color: {ttDeptFilter === dept ? 'var(--accent)' : 'var(--muted)'}; background: {ttDeptFilter === dept ? 'var(--tint)' : 'transparent'};"
							>{dept}</button>
						{/each}
					</div>
				{/if}

				{#if !crBatchNames.length}
					<p class="text-xs py-8 text-center" style="color: var(--muted);">no batches assigned — ask an admin to assign batches to your CR account</p>
				{:else if calendarBlocks.length === 0 && loadingCourses}
					<p class="text-xs animate-pulse" style="color: var(--muted);">loading timetable...</p>
				{:else}
					<div class="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
						<div class="min-w-[600px]">
							<div class="grid" style="grid-template-columns: 50px repeat({DAYS.length}, 1fr); border: 1px solid var(--border);">
								<div style="border-bottom: 1px solid var(--border); border-right: 1px solid var(--border);"></div>
								{#each DAYS as day}
									<div class="px-1 py-2 text-center text-[8px] uppercase tracking-[0.08em]"
										style="border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); color: var(--muted);">
										<span class="hidden md:inline">{day}</span><span class="md:hidden">{day.slice(0, 3)}</span>
									</div>
								{/each}

								{#each timeLabels as { mins, label }, i}
									{#if i < timeLabels.length - 1}
										{@const blockStarts = blockStartsByHour.get(mins) ?? []}
										<div class="relative px-0.5 text-right" style="height: {CELL_H}px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);">
											<span class="text-[7px]" style="color: var(--muted);">{label}</span>
											{#each blockStarts as bMin}
												{@const yOff = ((bMin - mins) / 60) * CELL_H}
												<span class="absolute right-0.5 text-[6px]" style="top: {yOff}px; color: var(--border);">{minutesToTime(bMin)}</span>
											{/each}
										</div>
										{#each DAYS as day}
											{@const hStart = mins}
											{@const hEnd = mins + 60}
											<div class="relative" style="height: {CELL_H}px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);"
												role="cell" tabindex="-1"
												data-day={day} data-hstart={hStart}
												ondragover={(e) => onDragOver(e, day, hStart)}
												ondrop={(e) => onDrop(e, day, hStart)}>
												{#each calendarCells.get(day + '|' + hStart) ?? [] as block (block.isUWE + block.course.key)}
													{@const top = ((block.startMin - hStart) / 60) * CELL_H}
													{@const h = ((block.endMin - block.startMin) / 60) * CELL_H}
													{@const level = block.isUWE ? getTrafficLight(block.course.base) : null}
													{@const violation = block.isUWE ? null : blockConstraintViolation(block.course, block.day, block.startMin, block.endMin)}
													{@const uweKey = block.day + '|' + block.startMin + '|' + block.endMin}
													{@const uweGroup = block.isUWE ? (uweGroups.get(uweKey) ?? []) : []}
													{@const uweIdx = block.isUWE ? uweGroup.indexOf(block) : 0}
													{@const activeUweIdx = (uweGroupActive.get(uweKey) ?? 0) % (uweGroup.length || 1)}
													{#if !block.isUWE || uweIdx === activeUweIdx}
													<div role="button" tabindex="0"
														class="absolute right-0.5 overflow-hidden px-1 py-0.5 {block.isUWE ? 'cursor-pointer left-0' : 'cursor-grab active:cursor-grabbing left-0.5'}"
														onmouseenter={(e) => hoverAt(e, block.course, violation)}
														onmousemove={(e) => hoverAt(e, block.course, violation)}
														onmouseleave={() => (hoverInfo = null)}
														style="top: {top}px; height: {h}px; min-height: 20px; background: {violation ? tColors.red + '1f' : block.isUWE ? 'var(--tint-strong)' : 'var(--block)'}; border: 1px solid {violation ? tColors.red : block.isUWE && level ? tColors[level] + '66' : 'var(--border)'}; z-index: {block.isUWE ? 1 : 2}; {violation ? 'border-left: 3px solid ' + tColors.red + ';' : block.isUWE ? 'border-left: 3px solid ' + (level ? tColors[level] : 'var(--border)') + ';' : ''}"
														draggable={!block.isUWE}
														ondragstart={(e) => { if (!block.isUWE) onDragStart(e, block.course, block.originalDay, block.isUWE); }}
														ontouchstart={(e) => { if (!block.isUWE) onTouchStart(e, block.course, block.originalDay, block.isUWE); }}
														onclick={(e) => { if (block.isUWE && uweGroup.length > 1) cycleUwe(uweKey, uweGroup.length, e); }}>
														{#if block.isUWE && uweGroup.length > 1}
															<div style="position: absolute; top: 2px; right: 2px; background: {level ? tColors[level] : 'var(--muted)'}; color: #000; border-radius: 3px; padding: 0 3px; font-size: 7px; font-weight: 700; line-height: 12px; letter-spacing: 0.03em; pointer-events: none;">
																{activeUweIdx + 1}/{uweGroup.length}
															</div>
														{/if}
														<!-- Line-height is 1.5, so lines cost 15 / 12 / 13.5 / 12px on top of 4px
														     padding — cumulative 19 / 31 / 44.5 / 56.5. Drop lines that would spill
														     instead of clipping them; hover or tap shows the full details. -->
														<!-- Tracked-course labels scroll themselves so they're readable without any
														     interaction; they're also hoverable and tappable for the full details.
														     Drops still land because drag events bubble to the grid cell, and core
														     blocks sit above overlays (z-index 2 vs 1) so they stay grabbable. -->
														<div class="text-[10px] font-medium {block.isUWE ? 'tt-scroll' : 'truncate'}" style="color: {block.isUWE ? (level ? tColors[level] : 'var(--fg)') : 'var(--fg)'}; padding-right: {block.isUWE && uweGroup.length > 1 ? '18px' : '0'};"><span>{block.course.base}</span></div>
														{#if sectionBatch(block.course) && h > 31}
															<div class="text-[8px] uppercase tracking-[0.06em] {block.isUWE ? 'tt-scroll' : 'truncate'}" style="color: var(--accent);"><span>{block.course.component} · {sectionBatch(block.course)}</span></div>
														{/if}
														{#if h > 45}
															<div class="text-[9px] {block.isUWE ? 'tt-scroll' : 'truncate'}" style="color: var(--muted);"><span>{block.course.courseName}</span></div>
														{/if}
														{#if h > 57}
															<div class="text-[8px] {block.isUWE ? 'tt-scroll' : 'truncate'}" style="color: var(--muted);"><span>{block.course.component ?? ''}{block.course.room ? ' • ' + block.course.room : ''}{block.course.faculty ? ' • ' + block.course.faculty : ''}</span></div>
														{/if}
													</div>
													{/if}
												{/each}
											<!-- Ghost blocks (original positions of moved courses) -->
											{#if showOriginals}
												{#each ghostCells.get(day + '|' + hStart) ?? [] as ghost}
													{@const gTop = ((ghost.startMin - hStart) / 60) * CELL_H}
													{@const gH = Math.max(14, ((ghost.endMin - ghost.startMin) / 60) * CELL_H)}
													<div class="absolute left-0.5 right-0.5 overflow-hidden px-1 py-0.5 pointer-events-none"
														style="top: {gTop}px; height: {gH}px; border: 1px dashed var(--muted); opacity: 0.4; z-index: 1;">
														<div class="text-[7px] truncate" style="color: var(--muted);">{baseCode(ghost.courseCode)}</div>
													</div>
												{/each}
											{/if}
											{#if dragOverSlot?.day === day && dragOverSlot?.startMin >= hStart && dragOverSlot?.startMin < hEnd}
												{@const dropY = ((dragOverSlot.startMin - hStart) / 60) * CELL_H}
												<div class="absolute left-0.5 right-0.5" style="top: {dropY}px; height: 2px; background: var(--accent); z-index: 3;"></div>
												<span class="absolute text-[6px] z-[4]" style="top: {dropY - 8}px; right: 2px; color: var(--accent);">{minutesToTime(dragOverSlot.startMin)}</span>
											{/if}
											</div>
										{/each}
									{/if}
								{/each}
							</div>
						</div>
					</div>
				{/if}

				<!-- Overlay controls: what the students asked for, then the CR's own watch list -->
				{#if demand.length > 0 || myCourses.length > 0}
					<div class="flex flex-col gap-4 pt-3" style="border-top: 1px solid var(--border);">
						{#if demand.length > 0}
							<!-- Top 3 UWEs (auto-shown) -->
							<div class="flex flex-col gap-2">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">top 3 uwes (shown on timetable)</span>
									<div class="flex gap-1.5">
										{#each [['demand', 'by demand'], ['conflict', 'least conflict']] as [mode, label]}
											<button onclick={() => setTopUweMode(mode as 'demand' | 'conflict')}
												class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
												style="border-color: {topUweMode === mode ? 'var(--accent)' : 'var(--border)'}; color: {topUweMode === mode ? 'var(--accent)' : 'var(--muted)'}; background: {topUweMode === mode ? 'var(--tint)' : 'transparent'};"
											>{label}</button>
										{/each}
									</div>
								</div>
								<div class="grid grid-cols-1 gap-1.5 md:grid-cols-3">
									{#each rankedDemand.slice(0, 3) as item, rank}
										{@const level = getTrafficLight(item.courseCode)}
										{@const courseName = namesByBase.get(item.courseCode)}
										{@const conf = courseConflicts.get(item.courseCode)}
										<button
											onclick={() => toggleCourseOverlay(item.courseCode)}
											class="flex cursor-pointer items-center gap-2 border px-2.5 py-2 text-left transition-colors duration-150"
											style="border-color: {enabledCourses.has(item.courseCode) ? (tColors[level] + '66') : 'var(--border)'}; background: {enabledCourses.has(item.courseCode) ? 'var(--tint)' : 'transparent'}; border-left: 3px solid {tColors[level]};"
										>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-1.5">
													<span class="text-[10px] font-medium" style="color: var(--fg);">{item.courseCode}</span>
													{#if topUweMode === 'demand'}
														<span class="text-[8px]" style="color: var(--muted);">P{rank + 1}</span>
													{:else if conf && conf.score > 0}
														<span class="text-[8px]">
															{#if conf.red > 0}<span style="color: {tColors.red};">{conf.red}R</span>{/if}{#if conf.red > 0 && conf.yellow > 0}<span style="color: var(--muted);">·</span>{/if}{#if conf.yellow > 0}<span style="color: {tColors.yellow};">{conf.yellow}Y</span>{/if}
														</span>
													{:else}
														<span class="text-[8px]" style="color: {tColors.green};">clear</span>
													{/if}
												</div>
												{#if courseName}<div class="text-[8px] truncate" style="color: var(--muted);">{courseName}</div>{/if}
											</div>
											<div class="flex flex-col items-end flex-shrink-0">
												<span class="text-[9px] font-medium" style="color: var(--fg);">{item.priorityScore}</span>
												<span class="text-[7px]" style="color: var(--muted);">{item.p1}/{item.p2}/{item.p3}</span>
											</div>
										</button>
									{/each}
								</div>
							</div>

							<!-- Rest of UWEs as toggles -->
							{#if restDemandedUWEs.length > 0}
								<div class="flex flex-col gap-2">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">other demanded uwes — click to overlay</span>
										<div class="flex gap-1.5">
											{#each [['course', 'by course'], ['demand', 'by demand'], ['conflict', 'least conflict']] as [mode, label]}
												<button onclick={() => restUweSort = mode as 'course' | 'demand' | 'conflict'}
													class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
													style="border-color: {restUweSort === mode ? 'var(--accent)' : 'var(--border)'}; color: {restUweSort === mode ? 'var(--accent)' : 'var(--muted)'}; background: {restUweSort === mode ? 'var(--tint)' : 'transparent'};"
												>{label}</button>
											{/each}
										</div>
									</div>
									<div class="flex flex-wrap gap-1.5">
										{#each restDemandedUWEs as item}
											{@const level = getTrafficLight(item.courseCode)}
											{@const active = enabledCourses.has(item.courseCode)}
											<button
												onclick={() => toggleCourseOverlay(item.courseCode)}
												class="cursor-pointer border px-2 py-1 text-[10px] tracking-wide transition-all duration-150"
												style="border-color: {active ? (tColors[level] + '88') : 'var(--border)'}; color: {active ? 'var(--fg)' : 'var(--muted)'}; background: {active ? 'var(--tint)' : 'transparent'};"
											>
												<span class="inline-block h-1 w-1 rounded-full mr-1" style="background: {tColors[level]};"></span>
												{item.courseCode}
												<span class="text-[7px] ml-0.5" style="color: var(--muted);">{item.priorityScore}</span>
											</button>
										{/each}
									</div>
								</div>
							{/if}
						{/if}

						{#if myCourses.length > 0}
						<div class="flex flex-col gap-2">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">your courses — click to overlay</span>
								<div class="flex gap-1.5">
									{#each [['course', 'by course'], ['conflict', 'least conflict']] as [mode, label]}
										<button onclick={() => listSort = mode as 'course' | 'conflict'}
											class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.08em] transition-all duration-150"
											style="border-color: {listSort === mode ? 'var(--accent)' : 'var(--border)'}; color: {listSort === mode ? 'var(--accent)' : 'var(--muted)'}; background: {listSort === mode ? 'var(--tint)' : 'transparent'};"
										>{label}</button>
									{/each}
								</div>
							</div>
							<div class="flex flex-wrap gap-1.5">
								{#each sortedMyCourses as item}
									{@const level = getTrafficLight(item.courseCode)}
									{@const active = enabledCourses.has(item.courseCode)}
									{@const conf = courseConflicts.get(item.courseCode)}
									<button
										onclick={() => toggleCourseOverlay(item.courseCode)}
										class="cursor-pointer border px-2 py-1 text-[10px] tracking-wide transition-all duration-150"
										style="border-color: {active ? (tColors[level] + '88') : 'var(--border)'}; color: {active ? 'var(--fg)' : 'var(--muted)'}; background: {active ? 'var(--tint)' : 'transparent'};"
									>
										<span class="inline-block h-1 w-1 rounded-full mr-1" style="background: {tColors[level]};"></span>
										{item.courseCode}
										{#if conf && conf.score > 0}
											<span class="text-[7px] ml-0.5">
												{#if conf.red > 0}<span style="color: {tColors.red};">{conf.red}R</span>{/if}{#if conf.red > 0 && conf.yellow > 0}<span style="color: var(--muted);">·</span>{/if}{#if conf.yellow > 0}<span style="color: {tColors.yellow};">{conf.yellow}Y</span>{/if}
											</span>
										{/if}
									</button>
								{/each}
							</div>
						</div>
						{/if}

						<!-- Legend -->
						<div class="flex flex-wrap gap-4">
							{#each [['#22c55e', 'no conflict'], ['#eab308', 'tutorial overlap'], ['#ef4444', 'lecture conflict']] as [color, label]}
								<div class="flex items-center gap-1.5">
									<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: {color};"></span>
									<span class="text-[8px] uppercase tracking-[0.1em]" style="color: var(--muted);">{label}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

		<!-- ==================== CR: CONSTRAINTS ==================== -->
		{:else if activeTab === 'settings'}
			<div class="animate-in mx-auto flex w-full max-w-5xl flex-col gap-6">
				<div class="flex flex-col gap-1">
					<h1 class="title-xl">Professor constraints</h1>
					<p class="hint">Block the times a professor is unavailable. Blocked slots refuse a class when you drag it there on the timetable.</p>
				</div>

				<div class="grid gap-5 lg:grid-cols-2 lg:items-start">
				<!-- Add form -->
				<div class="card card-pad flex flex-col gap-4">
					<div class="flex flex-col">
						<label for="prof-input" class="field-label">Professor <span style="color: var(--muted); font-weight: 400;">— search by name or course code</span></label>
						<div class="relative">
							<input id="prof-input" bind:value={profName} placeholder="e.g. Sharma or ECE204"
								autocomplete="off"
								oninput={() => profSuggestOpen = true}
								onfocus={() => profSuggestOpen = true}
								onblur={() => setTimeout(() => profSuggestOpen = false, 150)}
								class="input" />
							{#if profSuggestions.length}
								<div class="card absolute left-0 top-full z-10 mt-1 max-h-60 w-full overflow-y-auto p-1" style="box-shadow: var(--shadow-lg);">
									{#each profSuggestions as p}
										<button
											onmousedown={() => { profName = p.name; profSuggestOpen = false; }}
											ontouchstart={() => { profName = p.name; profSuggestOpen = false; }}
											class="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-md border-none bg-transparent px-3 py-2.5 text-left transition-colors duration-100"
											style="color: var(--muted);"
											onmouseenter={(e) => { e.currentTarget.style.background = 'var(--tint)'; e.currentTarget.style.color = 'var(--fg)'; }}
											onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
										>
											<span class="min-w-0 truncate text-sm" style="color: var(--fg);">{p.name}</span>
											<span class="shrink-0 font-mono text-xs uppercase tracking-[0.05em]">{p.codes.slice(0, 4).join(', ')}{p.codes.length > 4 ? ` +${p.codes.length - 4}` : ''}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>
					<div class="flex items-end gap-3">
						<div class="flex flex-1 flex-col">
							<label for="c-day" class="field-label">Day</label>
							<select id="c-day" bind:value={constraintDay} class="select">
								{#each DAY_LIST as d}<option value={d}>{d}</option>{/each}
							</select>
						</div>
						<label class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5" style="border-color: var(--border);">
							<input type="checkbox" bind:checked={allDay} style="accent-color: var(--accent); width: 1rem; height: 1rem;" />
							<span class="text-sm" style="color: var(--fg);">All day</span>
						</label>
					</div>
					{#if !allDay}
						<div class="flex gap-3">
							<div class="flex flex-1 flex-col">
								<label for="c-from" class="field-label">From</label>
								<input id="c-from" type="time" bind:value={cStartTime} class="input" />
							</div>
							<div class="flex flex-1 flex-col">
								<label for="c-to" class="field-label">To</label>
								<input id="c-to" type="time" bind:value={cEndTime} class="input" />
							</div>
						</div>
					{/if}
					<button onclick={addConstraint} disabled={savingConstraint} class="btn btn-primary">{savingConstraint ? 'adding…' : 'add constraint'}</button>
				</div>

				<!-- List -->
				<div class="card card-pad flex flex-col gap-3">
					<span class="eyebrow">Active ({constraints.length})</span>
					{#each constraints as c}
						<div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5" style="border-color: var(--border);">
							<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
								<span class="text-sm font-semibold" style="color: var(--fg);">{c.professorName}</span>
								<span class="font-mono text-xs" style="color: var(--muted);">{c.day}{c.allDay ? ' · all day' : ` · ${c.startTime}–${c.endTime}`}</span>
							</div>
							<button onclick={() => removeConstraint(c.id)}
								class="shrink-0 cursor-pointer border-none bg-transparent text-xs font-medium transition-colors"
								style="color: var(--muted);"
								onmouseenter={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
								onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
							>remove</button>
						</div>
					{:else}
						<p class="hint">No constraints set.</p>
					{/each}
				</div>
				</div>
			</div>

		<!-- ==================== MY TIMETABLE / BROWSE ANY BATCH ==================== -->
		{:else if activeTab === 'mytimetable'}
			<div class="animate-in mx-auto flex w-full max-w-5xl flex-col gap-6">
				<div class="flex flex-col gap-1">
					<h1 class="title-xl">{viewAsStudent ? 'My timetable' : 'Browse a batch'}</h1>
					<p class="hint">{selectedBatches.length ? 'Weekly schedule across the batches below (read-only).' : 'Enter batch code(s) and load to see the weekly schedule.'}</p>
				</div>

				<!-- Batch selector -->
				<div class="card flex flex-col gap-2.5 p-4 max-w-md">
					<span class="eyebrow">Batches</span>
					<div class="grid gap-2" style="grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));">
						{#each batchInputs as input, i}
							<div class="relative flex items-center gap-2">
								<input
									type="text"
									bind:value={batchInputs[i]}
									oninput={() => onBatchInput(i)}
									onfocus={() => onBatchInput(i)}
									onblur={() => setTimeout(() => { batchSuggestions[i] = []; batchSuggestions = [...batchSuggestions]; }, 150)}
									placeholder="e.g. CSE2X"
									autocomplete="off"
									class="input uppercase"
								/>
								{#if batchInputs.length > 1}
									<button onclick={() => removeBatchInput(i)} aria-label="Remove batch"
										class="grid h-9 w-9 shrink-0 place-items-center rounded-md border transition-colors duration-150"
										style="border-color: var(--border); color: var(--muted);"
										onmouseenter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'var(--danger)'; }}
										onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
									>&times;</button>
								{/if}
								<!-- Suggestions dropdown -->
								{#if batchSuggestions[i]?.length}
									<div class="card absolute left-0 top-full z-10 mt-1 max-h-44 w-full overflow-y-auto p-1" style="box-shadow: var(--shadow-lg);">
										{#each batchSuggestions[i] as suggestion}
											<button
												onmousedown={() => selectBatchSuggestion(i, suggestion)}
												ontouchstart={() => selectBatchSuggestion(i, suggestion)}
												class="block w-full cursor-pointer rounded-md border-none bg-transparent px-3 py-2.5 text-left text-sm uppercase transition-colors duration-100"
												style="color: var(--muted);"
												onmouseenter={(e) => { e.currentTarget.style.background = 'var(--tint)'; e.currentTarget.style.color = 'var(--fg)'; }}
												onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
											>{suggestion}</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<div class="flex items-center gap-3">
						{#if batchInputs.length < 4}
							<button onclick={addBatchInput} class="linkbtn">+ add batch</button>
						{/if}
						<div class="flex-1"></div>
						<button onclick={loadBatches} class="btn btn-primary btn-sm">load timetable</button>
					</div>
				</div>

				<!-- Timetable grid -->
				{#if selectedBatches.length && browseBlocks.length}
					<div class="nood-mono overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
						<div class="min-w-[600px]">
							<div class="grid" style="grid-template-columns: 50px repeat({DAYS.length}, 1fr); border: 1px solid var(--border);">
								<div style="border-bottom: 1px solid var(--border); border-right: 1px solid var(--border);"></div>
								{#each DAYS as day}
									<div class="px-1 py-2 text-center text-[8px] uppercase tracking-[0.08em]"
										style="border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); color: var(--muted);">
										<span class="hidden md:inline">{day}</span><span class="md:hidden">{day.slice(0, 3)}</span>
									</div>
								{/each}
								{#each sTimeLabels as { mins, label }, i}
									{#if i < sTimeLabels.length - 1}
										<div class="relative px-0.5 text-right" style="height: 56px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);">
											<span class="text-[9px]" style="color: var(--muted);">{label}</span>
										</div>
										{#each DAYS as day}
											{@const hStart = mins}
											{@const hEnd = mins + 60}
											<div class="relative" style="height: 56px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);">
												{#each browseCells.get(day + '|' + hStart) ?? [] as block (block.course.key)}
													{@const top = ((block.startMin - hStart) / 60) * 100}
													{@const h = ((block.endMin - block.startMin) / 60) * 56}
													<div role="note" class="absolute left-0.5 right-0.5 overflow-hidden px-1 py-0.5"
														onmouseenter={(e) => hoverAt(e, block.course, null)}
														onmousemove={(e) => hoverAt(e, block.course, null)}
														onmouseleave={() => (hoverInfo = null)}
														style="top: {top}%; height: {h}px; min-height: 24px; background: var(--block); border: 1px solid var(--border);">
														<div class="text-[10px] font-medium truncate" style="color: var(--fg);">{block.course.base}</div>
														{#if sectionBatch(block.course) && h > 31}
															<div class="truncate text-[8px] uppercase tracking-[0.06em]" style="color: var(--accent);">{block.course.component} · {sectionBatch(block.course)}</div>
														{/if}
														{#if h > 45}
															<div class="text-[9px] truncate" style="color: var(--muted);">{block.course.courseName}</div>
														{/if}
														{#if h > 57}
															<div class="text-[8px] truncate" style="color: var(--muted);">{block.course.room} • {block.course.faculty}</div>
														{/if}
													</div>
												{/each}
											</div>
										{/each}
									{/if}
								{/each}
							</div>
						</div>
					</div>
				{:else if selectedBatches.length}
					<div class="card card-pad text-center">
						<p class="hint">No courses found for these batches — double-check the codes above.</p>
					</div>
				{/if}
			</div>
		{/if}
	</main>

	<!-- Hover card for timetable blocks -->
	{#if hoverInfo}
		<div class="pointer-events-none fixed z-[60] max-w-[21rem] rounded-lg px-3 py-2 text-xs leading-relaxed"
			style="left: {hoverInfo.x}px; top: {hoverInfo.y}px; background: var(--surface); border: 1px solid var(--border); color: var(--fg); box-shadow: var(--shadow-lg);">
			{hoverInfo.text}
			{#if hoverInfo.warn}
				<div class="mt-1" style="color: #ef4444;">⚠ Prof. {hoverInfo.warn} has a constraint at this time</div>
			{/if}
		</div>
	{/if}

	<!-- Toast -->
	{#if toast}
		<div class="animate-in fixed bottom-6 left-1/2 z-50 flex max-w-[min(90vw,34rem)] -translate-x-1/2 items-center gap-2.5 rounded-2xl px-4 py-2.5 text-sm"
			style="background: var(--surface); border: 1px solid var(--border); color: var(--fg); box-shadow: var(--shadow-lg);">
			<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: var(--accent);"></span>{toast}
		</div>
	{/if}

	<!-- Heads-up before moving a class other people are counting on -->
	{#if moveWarnModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center px-4" style="background: rgba(0,0,0,0.55); backdrop-filter: blur(2px);" onclick={cancelDrop}>
			<div class="card animate-in flex w-full max-w-sm flex-col gap-5 p-6" style="box-shadow: var(--shadow-lg);" onclick={(e) => e.stopPropagation()}>
				<div class="flex flex-col gap-2">
					<span class="eyebrow" style="color: var(--accent);">heads up</span>
					<p class="text-base leading-relaxed" style="color: var(--fg);">
						{#if moveWarnModal.students}
							<span class="font-semibold">{moveWarnModal.students} {moveWarnModal.students === 1 ? 'student has' : 'students have'}</span> listed
							<span class="font-semibold">{moveWarnModal.courseCode}</span> as a UWE preference.
						{/if}
						{#if moveWarnModal.watchers}
							<span class="font-semibold">{moveWarnModal.watchers} other {moveWarnModal.watchers === 1 ? 'CR is' : 'CRs are'}</span> tracking
							<span class="font-semibold">{moveWarnModal.courseCode}</span>.
						{/if}
						Shifting this class may create conflicts for them.
					</p>
					<p class="hint">Do you still want to proceed with the move?</p>
				</div>
				<div class="flex justify-end gap-3">
					<button onclick={cancelDrop} class="btn btn-ghost btn-sm">cancel</button>
					<button onclick={confirmDrop} class="btn btn-primary btn-sm">yes, move it</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<footer class="border-t py-5 text-center" style="border-color: var(--border); background: var(--bg);">
	<span class="eyebrow" style="font-size: 0.6rem;">built &amp; maintained by
		<a href="https://github.com/rohitjg13" target="_blank" rel="noopener noreferrer" class="underline decoration-1 underline-offset-4 transition-colors" style="color: var(--muted);"
			onmouseenter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--accent)'; }}
			onmouseleave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--muted)'; }}
		>rohit j g</a>
	</span>
</footer>
