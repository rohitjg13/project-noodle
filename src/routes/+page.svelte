<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import type { Course, ConflictLevel } from '$lib/types';
	import { parseDays, timeToMinutes, minutesToTime, getConflictLevel } from '$lib/types';

	let { data } = $props();

	const isCR = data.user.role === 'cr';
	const isSuperAdmin = data.user.role === 'super_admin';
	const canManage = isCR || isSuperAdmin;

	let viewAsStudent = $state(!canManage);
	let activeTab = $state<'preferences' | 'mytimetable' | 'demand' | 'timetable' | 'settings'>(canManage ? 'demand' : 'preferences');

	// Batch selection (shared between student profile + my timetable)
	const savedBatch = data.preference?.batch ?? '';
	const savedBatchList = savedBatch ? savedBatch.split(',').map((b: string) => b.trim()).filter(Boolean) : [];
	let batchInputs = $state<string[]>(savedBatchList.length ? savedBatchList : ['']);
	let batchSuggestions = $state<string[][]>(savedBatchList.length ? savedBatchList.map(() => []) : [[]]);
	let activeSuggestionIdx = $state(-1);
	let selectedBatches = $state<string[]>(savedBatchList);

	// Student preference state
	let courses = $state<Course[]>([]);
	let loadingCourses = $state(true);
	let studentBatch = $state(savedBatch); // persisted batch string from DB
	let editingBatch = $state(!savedBatch); // show batch editor when no batch saved
	let minor = $state(data.preference?.minor ?? '');
	let uwePref1 = $state(data.preference?.uwePref1 ?? '');
	let uwePref2 = $state(data.preference?.uwePref2 ?? '');
	let uwePref3 = $state(data.preference?.uwePref3 ?? '');
	let locked = $state(data.preference?.locked ?? false);
	let submitting = $state(false);
	let batchSubmitting = $state(false);
	let prefError = $state('');
	let prefSuccess = $state('');

	// CR state
	let demand = $state<{ courseCode: string; p1: number; p2: number; p3: number; total: number; priorityScore: number }[]>([]);
	let constraints = $state<{ id: number; professorName: string; day: string; startTime: string | null; endTime: string | null; allDay: boolean; reason?: string | null }[]>([]);
	let totalStudents = $state(0);
	let deptFilter = $state('');
	let loadingCR = $state(true);

	// Timetable state
	let dragCourse = $state<Course | null>(null);
	let dragOriginalDay = $state(''); // the XLSX day of the slot being dragged
	let dragOffsetY = $state(0);
	let dragOverSlot = $state<{ day: string; startMin: number } | null>(null);
	// Override key: `courseCode|component|originalDay` — each day-slot independently overridable
	// Initialize from server-loaded data so overrides are available on first render
	function buildOverrideMapFromArray(blocks: { courseCode: string; component?: string | null; originalDay?: string | null; day: string; startTime: string; endTime: string }[]) {
		const map = new Map<string, { day: string; startTime: string; endTime: string }>();
		for (const b of blocks) {
			const origDay = b.originalDay ?? b.day;
			map.set(`${b.courseCode}|${b.component ?? ''}|${origDay}`, { day: b.day, startTime: b.startTime, endTime: b.endTime });
		}
		return map;
	}
	let scheduleOverrides = $state(buildOverrideMapFromArray(data.savedSchedule ?? []));
	// XLSX original positions before any overrides
	let xlsxOriginals = $state<Map<string, { day: string; startTime: string; endTime: string }>>(new Map());
	let showOriginals = $state(false);
	let syncStatus = $state<'idle' | 'saving' | 'saved' | 'error' | 'polling'>('idle');
	let lastSyncedAt = $state(0);
	// Time range extension (in whole hours, relative to auto-detected range)
	let extraHoursBefore = $state(0);
	let extraHoursAfter = $state(1); // start with 1hr extra at the end
	let toast = $state('');
	let toastTimeout: ReturnType<typeof setTimeout>;

	// Constraint form
	let profName = $state('');
	let constraintDay = $state('Monday');
	let allDay = $state(false);
	let cStartTime = $state('09:00');
	let cEndTime = $state('17:00');
	let cReason = $state('');
	let savingConstraint = $state(false);

	function showToast(msg: string) {
		toast = msg;
		clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => (toast = ''), 3000);
	}

	// Batch autocomplete
	let allBatches = $derived(() => {
		const set = new Set<string>();
		courses.forEach((c) => {
			if (c.major) c.major.split(/[\s,]+/).forEach((b) => { if (b.trim()) set.add(b.trim().toUpperCase()); });
		});
		return [...set].sort();
	});

	function getSuggestions(input: string): string[] {
		if (!input || input.length < 1) return [];
		const q = input.toUpperCase();
		return allBatches().filter((b) => b.includes(q) && b !== q).slice(0, 12);
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
		activeTab = 'mytimetable';
	}

	// Student timetable filtered by selected batches
	let studentCourses = $derived(
		courses.filter((c) => {
			if (!c.major || !selectedBatches.length) return false;
			const majors = c.major.toUpperCase().split(/[\s,]+/);
			return selectedBatches.some((ub) => majors.some((m) => m.includes(ub) || ub.includes(m)));
		})
	);
	let studentBlocks = $derived(() => {
		const blocks: { course: Course; day: string; startMin: number; endMin: number }[] = [];
		for (const c of studentCourses) {
			if (!c.day || !c.startTime || !c.endTime) continue;
			const days = parseDays(c.day);
			const s = timeToMinutes(c.startTime);
			const e = timeToMinutes(c.endTime);
			if (s >= e) continue;
			for (const d of days) blocks.push({ course: c, day: d, startMin: s, endMin: e });
		}
		return blocks;
	});
	let sMinT = $derived(Math.min(...(studentBlocks().map((b) => b.startMin).length ? studentBlocks().map((b) => b.startMin) : [480])));
	let sMaxT = $derived(Math.max(...(studentBlocks().map((b) => b.endMin).length ? studentBlocks().map((b) => b.endMin) : [1080])));
	let sRMin = $derived(Math.floor(sMinT / 60) * 60);
	let sRMax = $derived(Math.ceil(sMaxT / 60) * 60);
	let sTotalMin = $derived(sRMax - sRMin);
	let sTimeLabels = $derived(Array.from({ length: Math.floor(sTotalMin / 60) + 1 }, (_, i) => ({ mins: sRMin + i * 60, label: minutesToTime(sRMin + i * 60) })));

	// Derived course data
	let uweCourseOptions = $derived(
		[...new Map(courses.filter((c) => c.openAsUWE).map((c) => [c.courseCode.split('-')[0], c])).values()]
	);
	let minorPrograms = $derived(
		[...new Set(courses.filter((c) => c.courseType?.toLowerCase().includes('minor')).map((c) => c.courseName))]
	);
	let coreCourses = $derived(courses.filter((c) => !c.openAsUWE && c.day && c.startTime && c.endTime));
	let uweCourses = $derived(courses.filter((c) => c.openAsUWE && c.day && c.startTime && c.endTime));

	// CR batch names (all assigned batches)
	let crBatchNames = $derived(
		(data.crBatches ?? []).map((b: { batch: { name: string } }) => b.batch.name.toUpperCase())
	);

	// CR timetable: all courses matching ANY assigned batch, deduped
	function matchesCRBatch(major: string): boolean {
		if (!major || !crBatchNames.length) return false;
		const majors = major.toUpperCase().split(/[\s,]+/);
		return crBatchNames.some((bn: string) => majors.some((m: string) => m === bn));
	}

	function getTrafficLight(courseCode: string): ConflictLevel {
		// For CRs, check against their batch's timetable; for students, all core courses
		const cores = canManage ? crBatchCourses() : coreCourses;
		const variants = uweCourses.filter((c) => c.courseCode.startsWith(courseCode));
		if (!variants.length) return 'green';
		let best: ConflictLevel = 'red';
		for (const v of variants) {
			const level = getConflictLevel(v, cores);
			if (level === 'green') return 'green';
			if (level === 'yellow') best = 'yellow';
		}
		return best;
	}

	// Adjusted traffic light map — recomputes reactively when scheduleOverrides changes
	// Uses overridden positions for both UWE and core courses to detect resolved conflicts
	let adjustedConflictMap = $derived(() => {
		const map = new Map<string, ConflictLevel>();
		if (!canManage || scheduleOverrides.size === 0) return map;

		// Build adjusted core courses (CR batch courses with overrides applied)
		const adjustedCores: Course[] = [];
		for (const c of crBatchCourses()) {
			const origDays = parseDays(c.day || '');
			for (const origDay of origDays) {
				const override = scheduleOverrides.get(`${c.courseCode}|${c.component ?? ''}|${origDay}`);
				if (override) adjustedCores.push({ ...c, day: override.day, startTime: override.startTime, endTime: override.endTime });
				else adjustedCores.push({ ...c, day: origDay });
			}
		}

		for (const item of demand) {
			const orig = getTrafficLight(item.courseCode);
			if (orig === 'green') continue; // already fine, skip
			const variants = uweCourses.filter((c) => c.courseCode.startsWith(item.courseCode));
			let best: ConflictLevel = 'red';
			for (const v of variants) {
				const origDays = parseDays(v.day || '');
				if (!origDays.length || !v.startTime || !v.endTime) { best = 'green'; break; }
				let variantLevel: ConflictLevel = 'green';
				for (const origDay of origDays) {
					const override = scheduleOverrides.get(`${v.courseCode}|${v.component ?? ''}|${origDay}`);
					const synth = override
						? { ...v, day: override.day, startTime: override.startTime, endTime: override.endTime }
						: { ...v, day: origDay };
					const slotLevel = getConflictLevel(synth, adjustedCores);
					if (slotLevel === 'red') { variantLevel = 'red'; break; }
					if (slotLevel === 'yellow') variantLevel = 'yellow';
				}
				if (variantLevel === 'green') { best = 'green'; break; }
				if (variantLevel === 'yellow') best = 'yellow';
			}
			map.set(item.courseCode, best);
		}
		return map;
	});

	// Deduplicated batch courses (overrides applied per day-slot in calendarBlocks)
	let crBatchCourses = $derived(() => {
		const seen = new Set<string>();
		const result: Course[] = [];
		for (const c of courses) {
			if (!c.day || !c.startTime || !c.endTime) continue;
			if (!matchesCRBatch(c.major)) continue;
			const dedupKey = `${c.courseCode}|${c.component ?? ''}`;
			if (seen.has(dedupKey)) continue;
			seen.add(dedupKey);
			result.push(c);
		}
		return result;
	});

	// Capture XLSX original positions once courses load (keyed per day-slot)
	$effect(() => {
		if (courses.length > 0 && xlsxOriginals.size === 0) {
			const map = new Map<string, { day: string; startTime: string; endTime: string }>();
			for (const c of courses) {
				if (!c.day || !c.startTime || !c.endTime) continue;
				for (const d of parseDays(c.day)) {
					const key = `${c.courseCode}|${c.component ?? ''}|${d}`;
					if (!map.has(key)) map.set(key, { day: d, startTime: c.startTime, endTime: c.endTime });
				}
			}
			xlsxOriginals = map;
		}
	});

	// Ghost blocks: original positions of moved courses (key = courseCode|component|originalDay)
	type GhostBlock = { courseCode: string; courseName: string; day: string; startMin: number; endMin: number };
	let ghostBlocks = $derived(() => {
		if (!showOriginals) return [] as GhostBlock[];
		const blocks: GhostBlock[] = [];
		for (const [key, override] of scheduleOverrides) {
			const orig = xlsxOriginals.get(key);
			if (!orig) continue;
			if (orig.day === override.day && orig.startTime === override.startTime) continue; // not moved
			const s = timeToMinutes(orig.startTime);
			const e = timeToMinutes(orig.endTime);
			if (s >= e) continue;
			const courseCode = key.split('|')[0];
			const matchCourse = courses.find((c) => c.courseCode === courseCode);
			// orig.day is already a single day (key includes originalDay)
			blocks.push({ courseCode, courseName: matchCourse?.courseName ?? courseCode, day: orig.day, startMin: s, endMin: e });
		}
		return blocks;
	});

	// UWE overlay system for CR timetable
	let enabledUWEs = $state<Set<string>>(new Set());

	// Top 3 demanded UWEs (auto-enabled)
	let topDemandedUWEs = $derived(demand.slice(0, 3).map((d) => d.courseCode));
	let restDemandedUWEs = $derived(demand.slice(3));

	// Initialize top 3 UWEs as enabled once demand loads
	$effect(() => {
		if (topDemandedUWEs.length > 0 && enabledUWEs.size === 0) {
			enabledUWEs = new Set(topDemandedUWEs);
		}
	});

	function toggleUWE(code: string) {
		const next = new Set(enabledUWEs);
		if (next.has(code)) next.delete(code);
		else next.add(code);
		enabledUWEs = next;
	}

	// UWE overlay courses — returns one entry per course (multi-day applied in calendarBlocks)
	let uweOverlayCourses = $derived(() => {
		if (!enabledUWEs.size) return [];
		const seen = new Set<string>();
		const result: Course[] = [];
		for (const c of uweCourses) {
			const base = c.courseCode.split('-')[0];
			if (!enabledUWEs.has(base)) continue;
			const dedupKey = `${c.courseCode}|${c.component ?? ''}`;
			if (seen.has(dedupKey)) continue;
			seen.add(dedupKey);
			result.push(c);
		}
		return result;
	});

	// Calendar — combined batch courses + UWE overlays
	const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
	// originalDay = XLSX source day (used as override key); day = current rendered day (after override)
	type CalBlock = { course: Course; day: string; originalDay: string; startMin: number; endMin: number; isUWE: boolean };

	let calendarBlocks = $derived(() => {
		const blocks: CalBlock[] = [];
		const seen = new Set<string>();

		function addCourse(c: Course, isUWE: boolean) {
			const origDays = parseDays(c.day || '');
			const baseS = timeToMinutes(c.startTime || '');
			const baseE = timeToMinutes(c.endTime || '');
			if (baseS >= baseE) return;
			for (const origDay of origDays) {
				const overrideKey = `${c.courseCode}|${c.component ?? ''}|${origDay}`;
				const override = scheduleOverrides.get(overrideKey);
				const day = override?.day ?? origDay;
				const startMin = override ? timeToMinutes(override.startTime) : baseS;
				const endMin = override ? timeToMinutes(override.endTime) : baseE;
				const blockKey = `${c.courseCode}|${day}|${startMin}|${endMin}`;
				if (seen.has(blockKey)) continue;
				seen.add(blockKey);
				const course = override ? { ...c, day, startTime: override.startTime, endTime: override.endTime } : c;
				blocks.push({ course, day, originalDay: origDay, startMin, endMin, isUWE });
			}
		}

		for (const c of crBatchCourses()) addCourse(c, false);
		for (const c of uweOverlayCourses()) addCourse(c, true);
		return blocks;
	});

	let minT = $derived(Math.min(...(calendarBlocks().map((b) => b.startMin).length ? calendarBlocks().map((b) => b.startMin) : [480])));
	let maxT = $derived(Math.max(...(calendarBlocks().map((b) => b.endMin).length ? calendarBlocks().map((b) => b.endMin) : [1080])));
	let rMin = $derived(Math.floor(minT / 60) * 60);
	let rMax = $derived(Math.ceil(maxT / 60) * 60);
	// Displayed range with user-controlled extension
	let tDispMin = $derived(Math.max(0, rMin - extraHoursBefore * 60));
	let tDispMax = $derived(Math.min(1440, rMax + extraHoursAfter * 60));
	let totalMin = $derived(tDispMax - tDispMin);
	let timeLabels = $derived(Array.from({ length: Math.floor(totalMin / 60) + 1 }, (_, i) => ({ mins: tDispMin + i * 60, label: minutesToTime(tDispMin + i * 60) })));

	function isConstrained(day: string, startMin: number, endMin: number): string | null {
		for (const c of constraints) {
			if (c.day !== day) continue;
			if (c.allDay) return `Prof. ${c.professorName} unavailable`;
			if (c.startTime && c.endTime) {
				const cs = timeToMinutes(c.startTime), ce = timeToMinutes(c.endTime);
				if (startMin < ce && cs < endMin) return `Prof. ${c.professorName} unavailable`;
			}
		}
		return null;
	}

	// Fetch data
	$effect(() => {
		fetch('/api/timetable').then((r) => r.json()).then((d) => { courses = d.courses ?? []; }).catch(() => {}).finally(() => (loadingCourses = false));
		if (canManage) {
			Promise.all([
				fetch('/api/cr/demand').then((r) => r.json()),
				fetch('/api/cr/constraints').then((r) => r.json())
			]).then(([d, c]) => {
				demand = d.demand ?? [];
				totalStudents = d.totalStudents ?? 0;
				constraints = c.constraints ?? [];
			}).catch(() => {}).finally(() => (loadingCR = false));

			// Load saved schedule overrides (batch-independent key: courseCode|component)
			fetchOverrides();
		}
	});

	async function fetchOverrides() {
		try {
			const r = await fetch('/api/cr/schedule');
			if (!r.ok) return;
			const d = await r.json();
			scheduleOverrides = buildOverrideMapFromArray(d.blocks ?? []);
			lastSyncedAt = Date.now();
		} catch { /* ignore */ }
	}

	// Poll for live sync when timetable tab is open
	$effect(() => {
		if (activeTab !== 'timetable' || !canManage) return;
		const interval = setInterval(async () => {
			if (syncStatus === 'saving') return; // don't poll while saving
			await fetchOverrides();
		}, 5000);
		return () => clearInterval(interval);
	});

	// Student actions
	async function saveBatch() {
		const valid = batchInputs.map((b) => b.trim().toUpperCase()).filter(Boolean);
		if (!valid.length) { prefError = 'Enter at least one batch code'; return; }
		prefError = '';
		batchSubmitting = true;
		const batchStr = valid.join(',');
		const res = await fetch('/api/student/preferences', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ batch: batchStr, minor, uwePref1, uwePref2, uwePref3 })
		});
		if (!res.ok) { const d = await res.json(); prefError = d.error || 'Failed to save batch'; batchSubmitting = false; return; }
		studentBatch = batchStr;
		selectedBatches = valid;
		editingBatch = false;
		batchSubmitting = false;
	}

	async function submitPreferences() {
		prefError = '';
		prefSuccess = '';
		if (!studentBatch) { prefError = 'Set your batch first'; return; }
		if (!uwePref1) { prefError = 'At least your first UWE preference is required'; return; }
		const choices = [uwePref1, uwePref2, uwePref3].filter(Boolean);
		if (new Set(choices).size !== choices.length) { prefError = 'No duplicate UWE preferences'; return; }

		submitting = true;
		const res = await fetch('/api/student/preferences', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ batch: studentBatch, minor, uwePref1, uwePref2, uwePref3 })
		});
		if (!res.ok) { const d = await res.json(); prefError = d.error || 'Failed'; submitting = false; return; }
		prefSuccess = 'preferences saved';
		submitting = false;
	}

	// CR lock/unlock all preferences
	async function toggleLockAll() {
		const newState = !locked;
		const res = await fetch('/api/student/preferences/lock', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ locked: newState })
		});
		if (res.ok) { locked = newState; showToast(newState ? 'preferences locked' : 'preferences unlocked'); }
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
		savingConstraint = false;
	}

	async function removeConstraint(id: number) {
		await fetch('/api/cr/constraints', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
		constraints = constraints.filter((c) => c.id !== id);
	}

	// Drag and drop (5-minute snap, top-of-block anchor)
	const CELL_H = 56;
	const SNAP = 5;
	let lastDragUpdate = 0;

	function snapMin(rawMin: number): number {
		return Math.round(rawMin / SNAP) * SNAP;
	}

	function onDragStart(e: DragEvent, course: Course, originalDay: string) {
		dragCourse = course;
		dragOriginalDay = originalDay;
		dragOffsetY = e.offsetY;
	}

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

	async function onDrop(e: DragEvent, day: string, hStart: number) {
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const topY = (e.clientY - rect.top) - dragOffsetY;
		const rawMin = hStart + (topY / CELL_H) * 60;
		const dropMin = snapMin(rawMin);
		dragOverSlot = null;
		if (!dragCourse) return;
		const dur = timeToMinutes(dragCourse.endTime || '') - timeToMinutes(dragCourse.startTime || '');
		const msg = isConstrained(day, dropMin, dropMin + dur);
		if (msg) { showToast(msg); dragCourse = null; return; }

		const newStart = minutesToTime(dropMin);
		const newEnd = minutesToTime(dropMin + dur);

		const course = dragCourse;
		const origDay = dragOriginalDay;
		dragCourse = null;
		dragOriginalDay = '';
		const overrideKey = `${course.courseCode}|${course.component ?? ''}|${origDay}`;
		const prevOverride = scheduleOverrides.get(overrideKey);

		// Optimistic update — apply immediately so UI moves before API responds
		scheduleOverrides = new Map(scheduleOverrides).set(overrideKey, { day, startTime: newStart, endTime: newEnd });

		syncStatus = 'saving';
		try {
			const res = await fetch('/api/cr/schedule', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					courseCode: course.courseCode,
					component: course.component ?? '',
					originalDay: origDay,
					batch: (course.major || '').toUpperCase().split(/[\s,]+/).find((m) => crBatchNames.includes(m)) ?? course.major,
					day,
					startTime: newStart,
					endTime: newEnd,
					courseName: course.courseName,
					faculty: course.faculty,
					room: course.room
				})
			});
			if (res.ok) {
				lastSyncedAt = Date.now();
				syncStatus = 'saved';
				setTimeout(() => (syncStatus = 'idle'), 2500);
			} else {
				// Rollback on failure
				if (prevOverride) scheduleOverrides = new Map(scheduleOverrides).set(overrideKey, prevOverride);
				else { const m = new Map(scheduleOverrides); m.delete(overrideKey); scheduleOverrides = m; }
				syncStatus = 'error';
				setTimeout(() => (syncStatus = 'idle'), 3000);
			}
		} catch {
			// Rollback on failure
			if (prevOverride) scheduleOverrides = new Map(scheduleOverrides).set(overrideKey, prevOverride);
			else { const m = new Map(scheduleOverrides); m.delete(overrideKey); scheduleOverrides = m; }
			syncStatus = 'error';
			setTimeout(() => (syncStatus = 'idle'), 3000);
		}
	}

	function signOut() { window.location.href = '/auth/signout'; }

	const tColors: Record<string, string> = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };
	const DAY_LIST = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
</script>

<div class="flex min-h-dvh flex-col" style="background: var(--bg);">
	<!-- Header -->
	<header class="flex items-center justify-between px-4 py-3 md:px-8 md:py-4" style="border-bottom: 1px solid var(--border);">
		<div class="flex items-center gap-3 md:gap-5">
			<span class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">noodle</span>
			<span class="hidden text-[9px] uppercase tracking-[0.15em] md:inline" style="color: var(--muted);">{data.user.role === 'super_admin' ? 'admin' : data.user.role}</span>
		</div>
		<div class="flex items-center gap-3 md:gap-5">
			{#if canManage}
				<button onclick={() => { viewAsStudent = !viewAsStudent; if (viewAsStudent) activeTab = 'preferences'; else activeTab = 'demand'; }}
					class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.12em] transition-colors duration-200"
					style="color: var(--muted);"
					onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
					onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
				>{viewAsStudent ? 'cr view' : 'student view'}</button>
			{/if}
			{#if isSuperAdmin}
				<a href="/admin" class="text-[10px] uppercase tracking-[0.12em] no-underline transition-colors duration-200" style="color: var(--muted);">admin</a>
			{/if}
			<span class="hidden text-[10px] tracking-wide md:inline" style="color: var(--muted);">{data.user.email}</span>
			<button onclick={signOut}
				class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.12em] transition-colors duration-200"
				style="color: var(--muted);"
				onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
				onmouseleave={(e) => { e.currentTarget.style.color = 'var(--border)'; }}
			>sign out</button>
		</div>
	</header>

	<!-- Tabs -->
	<nav class="flex overflow-x-auto border-b px-4 md:px-8" style="border-color: var(--border);">
		{#if viewAsStudent || !canManage}
			<button onclick={() => activeTab = 'preferences'}
				class="cursor-pointer whitespace-nowrap border-none bg-transparent px-3 py-2.5 text-[10px] uppercase tracking-[0.12em]"
				style="color: {activeTab === 'preferences' ? 'var(--accent)' : 'var(--muted)'}; border-bottom: 1px solid {activeTab === 'preferences' ? 'var(--accent)' : 'transparent'}; margin-bottom: -1px;"
			>preferences</button>
			<button onclick={() => activeTab = 'mytimetable'}
				class="cursor-pointer whitespace-nowrap border-none bg-transparent px-3 py-2.5 text-[10px] uppercase tracking-[0.12em]"
				style="color: {activeTab === 'mytimetable' ? 'var(--accent)' : 'var(--muted)'}; border-bottom: 1px solid {activeTab === 'mytimetable' ? 'var(--accent)' : 'transparent'}; margin-bottom: -1px;"
			>my timetable</button>
		{/if}
		{#if !viewAsStudent && canManage}
			<button onclick={() => activeTab = 'demand'}
				class="cursor-pointer whitespace-nowrap border-none bg-transparent px-3 py-2.5 text-[10px] uppercase tracking-[0.12em]"
				style="color: {activeTab === 'demand' ? 'var(--accent)' : 'var(--muted)'}; border-bottom: 1px solid {activeTab === 'demand' ? 'var(--accent)' : 'transparent'}; margin-bottom: -1px;"
			>demand</button>
			<button onclick={() => activeTab = 'timetable'}
				class="cursor-pointer whitespace-nowrap border-none bg-transparent px-3 py-2.5 text-[10px] uppercase tracking-[0.12em]"
				style="color: {activeTab === 'timetable' ? 'var(--accent)' : 'var(--muted)'}; border-bottom: 1px solid {activeTab === 'timetable' ? 'var(--accent)' : 'transparent'}; margin-bottom: -1px;"
			>timetable</button>
			<button onclick={() => activeTab = 'settings'}
				class="cursor-pointer whitespace-nowrap border-none bg-transparent px-3 py-2.5 text-[10px] uppercase tracking-[0.12em]"
				style="color: {activeTab === 'settings' ? 'var(--accent)' : 'var(--muted)'}; border-bottom: 1px solid {activeTab === 'settings' ? 'var(--accent)' : 'transparent'}; margin-bottom: -1px;"
			>constraints</button>
		{/if}
	</nav>

	<!-- Content -->
	<main class="flex-1 px-4 py-6 md:px-8 md:py-8">

		<!-- ==================== STUDENT: PREFERENCES ==================== -->
		{#if activeTab === 'preferences'}
			<div class="mx-auto flex w-full max-w-lg flex-col gap-8">
				<!-- Profile -->
				<div class="flex flex-col gap-3">
					<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">your profile</h2>
					<div class="grid grid-cols-2 gap-2">
						{#each [['name', data.user.name], ['email', data.user.email], ['role', data.user.role]] as [label, value]}
							<div class="flex flex-col gap-0.5 border px-3 py-2.5" style="border-color: var(--border);">
								<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">{label}</span>
								<span class="text-xs truncate" style="color: var(--fg);">{value}</span>
							</div>
						{/each}
					</div>
				</div>

				<div class="h-px" style="background: var(--border);"></div>

				<!-- Batch setup / editor -->
				<div class="flex flex-col gap-4">
					<div class="flex items-center justify-between">
						<div>
							<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">your batch</h2>
							{#if !studentBatch}<p class="text-[9px] uppercase tracking-[0.08em] mt-0.5" style="color: #e44;">required before submitting preferences</p>{/if}
						</div>
						{#if studentBatch && !editingBatch}
							<button onclick={() => editingBatch = true}
								class="cursor-pointer border-none bg-transparent text-[9px] uppercase tracking-[0.12em] transition-colors duration-150"
								style="color: var(--muted);"
								onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
								onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
							>edit</button>
						{/if}
					</div>

					{#if !editingBatch && studentBatch}
						<!-- Saved batch display -->
						<div class="flex flex-wrap gap-1.5">
							{#each studentBatch.split(',').map(b => b.trim()).filter(Boolean) as b}
								<span class="border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em]" style="border-color: var(--border); color: var(--fg);">{b}</span>
							{/each}
						</div>
					{:else}
						<!-- Batch input editor -->
						<div class="flex flex-col gap-2">
							{#each batchInputs as input, i}
								<div class="relative flex gap-2">
									<input
										type="text"
										bind:value={batchInputs[i]}
										oninput={() => onBatchInput(i)}
										onfocus={() => onBatchInput(i)}
										onblur={() => setTimeout(() => { batchSuggestions[i] = []; batchSuggestions = [...batchSuggestions]; }, 150)}
										placeholder="e.g. ELC21"
										autocomplete="off"
										class="flex-1 border bg-transparent px-3 py-2.5 text-xs uppercase outline-none transition-colors duration-200 focus:border-[var(--muted)]"
										style="border-color: var(--border); color: var(--fg);"
									/>
									{#if batchInputs.length > 1}
										<button onclick={() => removeBatchInput(i)}
											class="cursor-pointer border-none bg-transparent px-2 text-xs transition-colors duration-200"
											style="color: var(--muted);"
											onmouseenter={(e) => { e.currentTarget.style.color = '#e44'; }}
											onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
										>&times;</button>
									{/if}
									{#if batchSuggestions[i]?.length}
										<div class="absolute left-0 top-full z-10 mt-0.5 max-h-40 w-full overflow-y-auto border"
											style="background: var(--surface); border-color: var(--border);">
											{#each batchSuggestions[i] as suggestion}
												<button
													onmousedown={() => selectBatchSuggestion(i, suggestion)}
													class="block w-full cursor-pointer border-none bg-transparent px-3 py-2 text-left text-[10px] uppercase tracking-[0.1em] transition-colors duration-100"
													style="color: var(--muted);"
													onmouseenter={(e) => { e.currentTarget.style.background = 'var(--border)'; e.currentTarget.style.color = 'var(--accent)'; }}
													onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
												>{suggestion}</button>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
							<div class="flex items-center gap-3 mt-1">
								{#if batchInputs.length < 4}
									<button onclick={addBatchInput}
										class="cursor-pointer border-none bg-transparent text-[9px] uppercase tracking-[0.1em] transition-colors duration-150"
										style="color: var(--muted);"
										onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
										onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
									>+ add batch</button>
								{/if}
								<div class="flex-1"></div>
								{#if studentBatch && editingBatch}
									<button onclick={() => { editingBatch = false; batchInputs = studentBatch.split(',').map(b => b.trim()).filter(Boolean); batchSuggestions = batchInputs.map(() => []); }}
										class="cursor-pointer border-none bg-transparent text-[9px] uppercase tracking-[0.12em] transition-colors duration-150"
										style="color: var(--muted);"
									>cancel</button>
								{/if}
								<button onclick={saveBatch} disabled={batchSubmitting}
									class="cursor-pointer border px-4 py-2 text-[9px] uppercase tracking-[0.15em] transition-all duration-200 disabled:opacity-30"
									style="border-color: var(--muted); color: var(--fg); background: transparent;"
									onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
									onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--muted)'; e.currentTarget.style.color = 'var(--fg)'; }}
								>{batchSubmitting ? 'saving...' : 'save batch'}</button>
							</div>
						</div>
					{/if}
				</div>

				<div class="h-px" style="background: var(--border);"></div>

				<!-- Preference form — gated behind batch -->
				{#if !studentBatch}
					<div class="flex flex-col items-center gap-3 py-6" style="border: 1px dashed var(--border);">
						<p class="text-xs" style="color: var(--muted);">set your batch above to unlock course preferences</p>
					</div>
				{:else}
					<div class="flex flex-col gap-5">
						<div class="flex items-center justify-between">
							<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">course preferences</h2>
							{#if locked}
								<span class="border px-2.5 py-1 text-[9px] uppercase tracking-[0.12em]" style="border-color: var(--border); color: var(--muted);">locked</span>
							{/if}
						</div>

						{#if loadingCourses}
							<p class="text-xs animate-pulse" style="color: var(--muted);">loading courses...</p>
						{:else}
							<div class="flex flex-col gap-2">
								<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">minor (optional)</span>
								<select bind:value={minor} disabled={locked}
									class="border bg-transparent px-3 py-2.5 text-xs outline-none disabled:opacity-30"
									style="border-color: var(--border); color: var(--fg); background: var(--bg);">
									<option value="">— none —</option>
									{#each minorPrograms as p}<option value={p}>{p}</option>{/each}
								</select>
							</div>

							{#each [{ l: 'uwe pref 1 (highest)', v: uwePref1, s: (x: string) => uwePref1 = x }, { l: 'uwe pref 2', v: uwePref2, s: (x: string) => uwePref2 = x }, { l: 'uwe pref 3 (lowest)', v: uwePref3, s: (x: string) => uwePref3 = x }] as pref}
								<div class="flex flex-col gap-2">
									<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">{pref.l}</span>
									<select value={pref.v} onchange={(e) => pref.s(e.currentTarget.value)} disabled={locked}
										class="border bg-transparent px-3 py-2.5 text-xs outline-none disabled:opacity-30"
										style="border-color: var(--border); color: var(--fg); background: var(--bg);">
										<option value="">— select —</option>
										{#each uweCourseOptions as c}<option value={c.courseCode.split('-')[0]}>{c.courseCode.split('-')[0]} — {c.courseName}</option>{/each}
									</select>
								</div>
							{/each}

							{#if prefError}<p class="text-xs" style="color: #e44;">{prefError}</p>{/if}
							{#if prefSuccess}<p class="text-xs" style="color: #4e4;">{prefSuccess}</p>{/if}

							{#if !locked}
								<button onclick={submitPreferences} disabled={submitting}
									class="mt-1 cursor-pointer border px-5 py-3 text-[10px] uppercase tracking-[0.2em] transition-all duration-300 hover:tracking-[0.25em] disabled:opacity-30 disabled:cursor-wait"
									style="background: transparent; border-color: var(--border); color: var(--muted);"
									onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--muted)'; e.currentTarget.style.color = 'var(--accent)'; }}
									onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
								>{submitting ? 'saving...' : data.preference ? 'update preferences' : 'submit preferences'}</button>
							{:else}
								<p class="text-[10px] uppercase tracking-[0.12em]" style="color: var(--muted);">editing is locked by your class rep</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

		<!-- ==================== STUDENT: MY TIMETABLE ==================== -->
		{:else if activeTab === 'mytimetable'}
			<div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
				<!-- Batch selector -->
				<div class="flex flex-col gap-3">
					<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">my timetable</h2>
					<p class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">enter your batch code(s) to view your schedule</p>

					<div class="flex flex-col gap-2">
						{#each batchInputs as input, i}
							<div class="relative flex gap-2">
								<input
									type="text"
									bind:value={batchInputs[i]}
									oninput={() => onBatchInput(i)}
									onfocus={() => onBatchInput(i)}
									onblur={() => setTimeout(() => { batchSuggestions[i] = []; batchSuggestions = [...batchSuggestions]; }, 150)}
									placeholder="e.g. CSE2X"
									autocomplete="off"
									class="flex-1 border bg-transparent px-3 py-2.5 text-xs uppercase outline-none transition-colors duration-200 focus:border-[var(--muted)]"
									style="border-color: var(--border); color: var(--fg);"
								/>
								{#if batchInputs.length > 1}
									<button onclick={() => removeBatchInput(i)}
										class="cursor-pointer border-none bg-transparent px-2 text-xs transition-colors duration-200"
										style="color: var(--muted);"
										onmouseenter={(e) => { e.currentTarget.style.color = '#e44'; }}
										onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
									>&times;</button>
								{/if}
								<!-- Suggestions dropdown -->
								{#if batchSuggestions[i]?.length}
									<div class="absolute left-0 top-full z-10 mt-0.5 max-h-40 w-full overflow-y-auto border"
										style="background: var(--surface); border-color: var(--border);">
										{#each batchSuggestions[i] as suggestion}
											<button
												onmousedown={() => selectBatchSuggestion(i, suggestion)}
												class="block w-full cursor-pointer border-none bg-transparent px-3 py-2 text-left text-[10px] uppercase tracking-[0.1em] transition-colors duration-100"
												style="color: var(--muted);"
												onmouseenter={(e) => { e.currentTarget.style.background = 'var(--border)'; e.currentTarget.style.color = 'var(--accent)'; }}
												onmouseleave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--muted)'; }}
											>{suggestion}</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<div class="flex gap-3">
						{#if batchInputs.length < 4}
							<button onclick={addBatchInput}
								class="cursor-pointer border-none bg-transparent text-[9px] uppercase tracking-[0.12em] transition-colors duration-200"
								style="color: var(--muted);"
								onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
								onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
							>+ add batch</button>
						{/if}
						<button onclick={loadBatches}
							class="cursor-pointer border px-4 py-2 text-[9px] uppercase tracking-[0.15em] transition-all duration-200"
							style="background: transparent; border-color: var(--border); color: var(--muted);"
							onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
							onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
						>load</button>
					</div>

					{#if selectedBatches.length}
						<div class="flex flex-wrap gap-1.5">
							{#each selectedBatches as b}
								<span class="border px-2 py-1 text-[9px] uppercase tracking-[0.1em]" style="border-color: var(--border); color: var(--fg);">{b}</span>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Timetable grid -->
				{#if selectedBatches.length && studentBlocks().length}
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
								{#each sTimeLabels as { mins, label }, i}
									{#if i < sTimeLabels.length - 1}
										<div class="relative px-0.5 text-right" style="height: 56px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);">
											<span class="text-[7px]" style="color: var(--muted);">{label}</span>
										</div>
										{#each DAYS as day}
											{@const hStart = mins}
											{@const hEnd = mins + 60}
											<div class="relative" style="height: 56px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);">
												{#each studentBlocks().filter((b) => b.day === day && b.startMin >= hStart && b.startMin < hEnd) as block}
													{@const top = ((block.startMin - hStart) / 60) * 100}
													{@const h = ((block.endMin - block.startMin) / 60) * 56}
													<div class="absolute left-0.5 right-0.5 overflow-hidden px-1 py-0.5"
														style="top: {top}%; height: {h}px; min-height: 24px; background: var(--surface); border: 1px solid var(--border);">
														<div class="text-[8px] font-medium truncate" style="color: var(--fg);">{block.course.courseCode.split('-')[0]}</div>
														<div class="text-[7px] truncate" style="color: var(--muted);">{block.course.courseName}</div>
														{#if h > 32}
															<div class="text-[6px] truncate" style="color: var(--muted);">{block.course.room} • {block.course.faculty}</div>
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
					<p class="text-center text-xs py-8" style="color: var(--muted);">no courses found for these batches</p>
				{/if}
			</div>

		<!-- ==================== CR: DEMAND ==================== -->
		{:else if activeTab === 'demand'}
			<div class="flex flex-col gap-6">
				<div class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">uwe demand</h2>
						<p class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">{totalStudents} submitted</p>
					</div>
					<div class="flex gap-3 mt-2 md:mt-0">
						<button onclick={toggleLockAll}
							class="cursor-pointer border px-3 py-2 text-[9px] uppercase tracking-[0.12em] transition-all duration-200"
							style="background: transparent; border-color: {locked ? '#e44' : 'var(--border)'}; color: {locked ? '#e44' : 'var(--muted)'};"
							onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
							onmouseleave={(e) => { e.currentTarget.style.color = locked ? '#e44' : 'var(--muted)'; }}
						>{locked ? 'unlock editing' : 'lock preferences'}</button>
						<select bind:value={deptFilter}
							class="border bg-transparent px-3 py-2 text-[10px] outline-none"
							style="border-color: var(--border); color: var(--fg); background: var(--bg);">
							<option value="">all depts</option>
						</select>
					</div>
				</div>

				{#if loadingCR}
					<p class="text-xs animate-pulse" style="color: var(--muted);">loading...</p>
				{:else}
					<div class="overflow-x-auto -mx-4 md:mx-0">
						<table class="w-full min-w-[480px] text-left text-xs" style="border-collapse: collapse;">
							<thead>
								<tr style="border-bottom: 1px solid var(--border);">
									<th class="px-3 py-2 text-[9px] uppercase tracking-[0.1em] font-normal" style="color: var(--muted);">course</th>
									<th class="px-3 py-2 text-[9px] uppercase tracking-[0.1em] font-normal" style="color: var(--muted);">p1/p2/p3</th>
									<th class="px-3 py-2 text-[9px] uppercase tracking-[0.1em] font-normal" style="color: var(--muted);">score</th>
									<th class="px-3 py-2 text-[9px] uppercase tracking-[0.1em] font-normal" style="color: var(--muted);">status</th>
								</tr>
							</thead>
							<tbody>
								{#each demand as item}
									{@const level = getTrafficLight(item.courseCode)}
									{@const adjustedLevel = adjustedConflictMap().get(item.courseCode) ?? level}
									{@const conflictCleared = level !== 'green' && adjustedLevel === 'green'}
									{@const match = courses.find((c) => c.courseCode.startsWith(item.courseCode))}
									<tr style="border-bottom: 1px solid var(--border);">
										<td class="px-3 py-2.5">
											<span class="font-medium" style="color: var(--fg);">{item.courseCode}</span>
											{#if match}<span class="ml-2 hidden text-[9px] md:inline" style="color: var(--muted);">{match.courseName}</span>{/if}
										</td>
										<td class="px-3 py-2.5" style="color: var(--muted);">{item.p1}/{item.p2}/{item.p3}</td>
										<td class="px-3 py-2.5">
											<span class="font-medium" style="color: var(--fg);">{item.priorityScore}</span>
											<span class="ml-2 text-[9px]" style="color: var(--muted);">{item.total} interested</span>
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
					{#if !demand.length}<p class="text-center text-xs py-8" style="color: var(--muted);">no submissions yet</p>{/if}

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
				{/if}
			</div>

		<!-- ==================== CR: TIMETABLE ==================== -->
		{:else if activeTab === 'timetable'}
			<div class="flex flex-col gap-5">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">weekly schedule</h2>
						<p class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">
							{#if crBatchNames.length}
								{crBatchNames.join(', ')} ·
							{/if}
							{crBatchCourses().length} courses
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-3">
						<!-- Originals toggle + reset -->
						{#if scheduleOverrides.size > 0}
							<button
								onclick={() => showOriginals = !showOriginals}
								class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] transition-all duration-150"
								style="border-color: {showOriginals ? 'var(--muted)' : 'var(--border)'}; color: {showOriginals ? 'var(--fg)' : 'var(--muted)'}; background: transparent;"
							>{showOriginals ? 'hide original' : 'show original'}</button>
							<button
								onclick={async () => {
									const prev = scheduleOverrides;
									scheduleOverrides = new Map();
									syncStatus = 'saving';
									try {
										const res = await fetch('/api/cr/schedule', { method: 'DELETE' });
										if (res.ok) {
											syncStatus = 'saved';
											setTimeout(() => (syncStatus = 'idle'), 2500);
										} else {
											scheduleOverrides = prev;
											syncStatus = 'error';
											setTimeout(() => (syncStatus = 'idle'), 3000);
										}
									} catch {
										scheduleOverrides = prev;
										syncStatus = 'error';
										setTimeout(() => (syncStatus = 'idle'), 3000);
									}
								}}
								class="cursor-pointer border px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] transition-all duration-150"
								style="border-color: var(--border); color: var(--muted); background: transparent;"
								onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = '#e44'; (e.currentTarget as HTMLElement).style.borderColor = '#e44'; }}
								onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
							>reset positions</button>
						{/if}
						<!-- Sync status -->
						<span class="text-[9px] uppercase tracking-[0.12em]" style="color: {syncStatus === 'saving' ? 'var(--muted)' : syncStatus === 'saved' ? '#4e4' : syncStatus === 'error' ? '#e44' : 'var(--border)'};">
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

				{#if !crBatchNames.length}
					<p class="text-xs py-8 text-center" style="color: var(--muted);">no batches assigned — ask an admin to assign batches to your CR account</p>
				{:else if calendarBlocks().length === 0 && loadingCourses}
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
										{@const blockStarts = [...new Set(calendarBlocks().filter((b) => b.startMin > mins && b.startMin < mins + 60).map((b) => b.startMin))].sort((a, b) => a - b)}
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
											{@const cMsg = isConstrained(day, hStart, hEnd)}
											<div class="relative" style="height: {CELL_H}px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); {cMsg ? 'background: rgba(255,255,255,0.02);' : ''}"
												role="cell" tabindex="-1"
												ondragover={(e) => onDragOver(e, day, hStart)}
												ondrop={(e) => onDrop(e, day, hStart)}>
												{#if cMsg}<div class="absolute inset-0 flex items-center justify-center opacity-15"><span class="text-[7px] uppercase" style="color: var(--muted);">locked</span></div>{/if}
												{#each calendarBlocks().filter((b) => b.day === day && b.startMin >= hStart && b.startMin < hEnd) as block}
													{@const top = ((block.startMin - hStart) / 60) * CELL_H}
													{@const h = ((block.endMin - block.startMin) / 60) * CELL_H}
													{@const level = block.isUWE ? getTrafficLight(block.course.courseCode.split('-')[0]) : null}
													<div role="button" tabindex="0"
														class="absolute left-0.5 right-0.5 overflow-hidden px-1 py-0.5 cursor-grab active:cursor-grabbing"
														style="top: {top}px; height: {h}px; min-height: 20px; background: {block.isUWE ? 'rgba(255,255,255,0.04)' : 'var(--surface)'}; border: 1px solid {block.isUWE && level ? tColors[level] + '66' : 'var(--border)'}; z-index: 2; {block.isUWE ? 'border-left: 3px solid ' + (level ? tColors[level] : 'var(--border)') + ';' : ''}"
														draggable="true" ondragstart={(e) => onDragStart(e, block.course, block.originalDay)}>
														<div class="text-[8px] font-medium truncate" style="color: {block.isUWE ? (level ? tColors[level] : 'var(--fg)') : 'var(--fg)'};">{block.course.courseCode.split('-')[0]}</div>
														<div class="text-[7px] truncate" style="color: var(--muted);">{block.course.courseName}</div>
														{#if h > 32}
															<div class="text-[6px] truncate" style="color: var(--muted);">
																{block.course.component ?? ''}{block.course.room ? ' • ' + block.course.room : ''}{block.course.faculty ? ' • ' + block.course.faculty : ''}
															</div>
														{/if}
													</div>
												{/each}
											<!-- Ghost blocks (original positions of moved courses) -->
											{#if showOriginals}
												{#each ghostBlocks().filter((g) => g.day === day && g.startMin >= hStart && g.startMin < hEnd) as ghost}
													{@const gTop = ((ghost.startMin - hStart) / 60) * CELL_H}
													{@const gH = Math.max(14, ((ghost.endMin - ghost.startMin) / 60) * CELL_H)}
													<div class="absolute left-0.5 right-0.5 overflow-hidden px-1 py-0.5 pointer-events-none"
														style="top: {gTop}px; height: {gH}px; border: 1px dashed var(--muted); opacity: 0.4; z-index: 1;">
														<div class="text-[7px] truncate" style="color: var(--muted);">{ghost.courseCode.split('-')[0]}</div>
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

				<!-- UWE overlay controls -->
				{#if demand.length > 0}
					<div class="flex flex-col gap-4 pt-3" style="border-top: 1px solid var(--border);">
						<!-- Top 3 UWEs (auto-shown) -->
						<div class="flex flex-col gap-2">
							<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">top 3 uwes (shown on timetable)</span>
							<div class="grid grid-cols-1 gap-1.5 md:grid-cols-3">
								{#each demand.slice(0, 3) as item, rank}
									{@const level = getTrafficLight(item.courseCode)}
									{@const match = courses.find((c) => c.courseCode.startsWith(item.courseCode))}
									<button
										onclick={() => toggleUWE(item.courseCode)}
										class="flex cursor-pointer items-center gap-2 border px-2.5 py-2 text-left transition-colors duration-150"
										style="border-color: {enabledUWEs.has(item.courseCode) ? (tColors[level] + '66') : 'var(--border)'}; background: {enabledUWEs.has(item.courseCode) ? 'rgba(255,255,255,0.02)' : 'transparent'}; border-left: 3px solid {tColors[level]};"
									>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-1.5">
												<span class="text-[10px] font-medium" style="color: var(--fg);">{item.courseCode}</span>
												<span class="text-[8px]" style="color: var(--muted);">P{rank + 1}</span>
											</div>
											{#if match}<div class="text-[8px] truncate" style="color: var(--muted);">{match.courseName}</div>{/if}
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
								<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">other demanded uwes — click to overlay</span>
								<div class="flex flex-wrap gap-1.5">
									{#each restDemandedUWEs as item}
										{@const level = getTrafficLight(item.courseCode)}
										{@const active = enabledUWEs.has(item.courseCode)}
										<button
											onclick={() => toggleUWE(item.courseCode)}
											class="cursor-pointer border px-2 py-1 text-[10px] tracking-wide transition-all duration-150"
											style="border-color: {active ? (tColors[level] + '88') : 'var(--border)'}; color: {active ? 'var(--fg)' : 'var(--muted)'}; background: {active ? 'rgba(255,255,255,0.03)' : 'transparent'};"
										>
											<span class="inline-block h-1 w-1 rounded-full mr-1" style="background: {tColors[level]};"></span>
											{item.courseCode}
											<span class="text-[7px] ml-0.5" style="color: var(--muted);">{item.priorityScore}</span>
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
			<div class="mx-auto flex w-full max-w-xl flex-col gap-8">
				<div>
					<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">professor constraints</h2>
					<p class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">blocked slots prevent drag-drop scheduling</p>
				</div>

				<!-- Add form -->
				<div class="flex flex-col gap-3 border p-4" style="border-color: var(--border);">
					<div class="flex flex-col gap-1">
						<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">professor</span>
						<input bind:value={profName} placeholder="Prof. Sharma"
							class="border bg-transparent px-3 py-2.5 text-xs outline-none"
							style="border-color: var(--border); color: var(--fg);" />
					</div>
					<div class="flex gap-3">
						<div class="flex flex-1 flex-col gap-1">
							<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">day</span>
							<select bind:value={constraintDay}
								class="border bg-transparent px-3 py-2.5 text-xs outline-none"
								style="border-color: var(--border); color: var(--fg); background: var(--bg);">
								{#each DAY_LIST as d}<option value={d}>{d}</option>{/each}
							</select>
						</div>
						<label class="flex items-center gap-1.5 self-end pb-2.5">
							<input type="checkbox" bind:checked={allDay} class="accent-white" />
							<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">all day</span>
						</label>
					</div>
					{#if !allDay}
						<div class="flex gap-3">
							<div class="flex flex-1 flex-col gap-1">
								<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">from</span>
								<input type="time" bind:value={cStartTime} class="border bg-transparent px-3 py-2.5 text-xs outline-none" style="border-color: var(--border); color: var(--fg);" />
							</div>
							<div class="flex flex-1 flex-col gap-1">
								<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">to</span>
								<input type="time" bind:value={cEndTime} class="border bg-transparent px-3 py-2.5 text-xs outline-none" style="border-color: var(--border); color: var(--fg);" />
							</div>
						</div>
					{/if}
					<button onclick={addConstraint} disabled={savingConstraint}
						class="cursor-pointer border px-4 py-2.5 text-[9px] uppercase tracking-[0.15em] transition-all duration-200 disabled:opacity-30"
						style="background: transparent; border-color: var(--border); color: var(--muted);"
						onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
						onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
					>{savingConstraint ? 'adding...' : 'add constraint'}</button>
				</div>

				<!-- List -->
				<div class="flex flex-col gap-2">
					<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">active ({constraints.length})</span>
					{#each constraints as c}
						<div class="flex items-center justify-between border px-3 py-2.5" style="border-color: var(--border);">
							<div class="min-w-0">
								<span class="text-xs font-medium" style="color: var(--fg);">{c.professorName}</span>
								<span class="ml-2 text-[9px]" style="color: var(--muted);">{c.day}{c.allDay ? '' : ` ${c.startTime}-${c.endTime}`}</span>
							</div>
							<button onclick={() => removeConstraint(c.id)}
								class="flex-shrink-0 cursor-pointer border-none bg-transparent text-[9px] uppercase tracking-[0.1em]"
								style="color: var(--muted);"
								onmouseenter={(e) => { e.currentTarget.style.color = '#e44'; }}
								onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
							>remove</button>
						</div>
					{:else}
						<p class="text-xs" style="color: var(--muted);">none set</p>
					{/each}
				</div>
			</div>
		{/if}
	</main>

	<!-- Toast -->
	{#if toast}
		<div class="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 border px-4 py-2.5 text-[10px]"
			style="background: var(--surface); border-color: var(--border); color: var(--fg);">{toast}</div>
	{/if}
</div>
