<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import type { Course, ConflictLevel } from '$lib/types';
	import { parseDays, timeToMinutes, minutesToTime, getConflictLevel } from '$lib/types';

	let { data } = $props();

	const isCR = data.user.role === 'cr';
	const isSuperAdmin = data.user.role === 'super_admin';
	const canManage = isCR || isSuperAdmin;

	let viewAsStudent = $state(!canManage);
	let activeTab = $state<'preferences' | 'mytimetable' | 'demand' | 'timetable' | 'settings'>('preferences');

	// Batch selection (Scooby-style multi-batch with autocomplete)
	let batchInputs = $state<string[]>(['']);
	let batchSuggestions = $state<string[][]>([[]]);
	let activeSuggestionIdx = $state(-1);
	let selectedBatches = $state<string[]>([]);

	// Student preference state
	let courses = $state<Course[]>([]);
	let loadingCourses = $state(true);
	let minor = $state(data.preference?.minor ?? '');
	let uwePref1 = $state(data.preference?.uwePref1 ?? '');
	let uwePref2 = $state(data.preference?.uwePref2 ?? '');
	let uwePref3 = $state(data.preference?.uwePref3 ?? '');
	let locked = $state(data.preference?.locked ?? false);
	let submitting = $state(false);
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
	let dragOffsetY = $state(0); // Y offset within block where user grabbed it
	let dragOverSlot = $state<{ day: string; startMin: number } | null>(null);
	let scheduleOverrides = $state<Map<string, { day: string; startTime: string; endTime: string }>>(new Map());
	let syncStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
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

	function getTrafficLight(courseCode: string): ConflictLevel {
		const variants = uweCourses.filter((c) => c.courseCode.startsWith(courseCode));
		if (!variants.length) return 'green';
		let best: ConflictLevel = 'red';
		for (const v of variants) {
			const level = getConflictLevel(v, coreCourses);
			if (level === 'green') return 'green';
			if (level === 'yellow') best = 'yellow';
		}
		return best;
	}

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

	let crBatchCourses = $derived(() => {
		const seen = new Set<string>();
		const result: Course[] = [];
		for (const c of courses) {
			if (!c.day || !c.startTime || !c.endTime) continue;
			if (!matchesCRBatch(c.major)) continue;
			// Dedup by courseCode + component (same lecture/lab appears once per batch group)
			const dedupKey = `${c.courseCode}|${c.component}`;
			if (seen.has(dedupKey)) continue;
			seen.add(dedupKey);
			// Apply DB override if one exists for this course+batch
			const batchName = (c.major || '').toUpperCase().split(/[\s,]+/).find((m) => crBatchNames.includes(m)) ?? c.major;
			const overrideKey = `${c.courseCode}|${c.component ?? ''}|${batchName}`;
			const override = scheduleOverrides.get(overrideKey);
			if (override) {
				result.push({ ...c, day: override.day, startTime: override.startTime, endTime: override.endTime });
			} else {
				result.push(c);
			}
		}
		return result;
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

	// UWE overlay courses (matching enabled UWE codes, with time info)
	let uweOverlayCourses = $derived(() => {
		if (!enabledUWEs.size) return [];
		const seen = new Set<string>();
		return uweCourses.filter((c) => {
			const base = c.courseCode.split('-')[0];
			if (!enabledUWEs.has(base)) return false;
			const key = `${c.courseCode}|${c.day}|${c.startTime}|${c.endTime}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	});

	// Calendar — combined batch courses + UWE overlays
	const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
	type CalBlock = { course: Course; day: string; startMin: number; endMin: number; isUWE: boolean };

	let calendarBlocks = $derived(() => {
		const blocks: CalBlock[] = [];
		const seen = new Set<string>();
		for (const c of crBatchCourses()) {
			const days = parseDays(c.day || '');
			const s = timeToMinutes(c.startTime || '');
			const e = timeToMinutes(c.endTime || '');
			if (s >= e) continue;
			for (const d of days) {
				const key = `${c.courseCode}|${d}|${s}|${e}`;
				if (!seen.has(key)) { seen.add(key); blocks.push({ course: c, day: d, startMin: s, endMin: e, isUWE: false }); }
			}
		}
		for (const c of uweOverlayCourses()) {
			const days = parseDays(c.day || '');
			const s = timeToMinutes(c.startTime || '');
			const e = timeToMinutes(c.endTime || '');
			if (s >= e) continue;
			for (const d of days) {
				const key = `${c.courseCode}|${d}|${s}|${e}`;
				if (!seen.has(key)) { seen.add(key); blocks.push({ course: c, day: d, startMin: s, endMin: e, isUWE: true }); }
			}
		}
		return blocks;
	});

	let minT = $derived(Math.min(...(calendarBlocks().map((b) => b.startMin).length ? calendarBlocks().map((b) => b.startMin) : [480])));
	let maxT = $derived(Math.max(...(calendarBlocks().map((b) => b.endMin).length ? calendarBlocks().map((b) => b.endMin) : [1080])));
	let rMin = $derived(Math.floor(minT / 60) * 60);
	let rMax = $derived(Math.ceil(maxT / 60) * 60);
	let totalMin = $derived(rMax - rMin);
	let timeLabels = $derived(Array.from({ length: Math.floor(totalMin / 60) + 1 }, (_, i) => ({ mins: rMin + i * 60, label: minutesToTime(rMin + i * 60) })));

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

			// Load saved schedule overrides for this CR's batches
			const batches = (data.crBatches ?? []).map((b: { batch: { name: string } }) => b.batch.name);
			if (batches.length) {
				fetch(`/api/cr/schedule?batches=${batches.join(',')}`)
					.then((r) => r.json())
					.then((d) => {
						const map = new Map<string, { day: string; startTime: string; endTime: string }>();
						for (const block of (d.blocks ?? [])) {
							const key = `${block.courseCode}|${block.component ?? ''}|${block.batch}`;
							map.set(key, { day: block.day, startTime: block.startTime, endTime: block.endTime });
						}
						scheduleOverrides = map;
					})
					.catch(() => {});
			}
		}
	});

	// Student actions
	async function submitPreferences() {
		prefError = '';
		prefSuccess = '';
		if (!uwePref1) { prefError = 'At least your first UWE preference is required'; return; }
		const choices = [uwePref1, uwePref2, uwePref3].filter(Boolean);
		if (new Set(choices).size !== choices.length) { prefError = 'No duplicate UWE preferences'; return; }

		submitting = true;
		const res = await fetch('/api/student/preferences', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ minor, uwePref1, uwePref2, uwePref3 })
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

	function snapMin(rawMin: number): number {
		return Math.round(rawMin / SNAP) * SNAP;
	}

	function onDragStart(e: DragEvent, course: Course) {
		dragCourse = course;
		// Capture Y offset within the block element so drop lands at block top, not cursor
		dragOffsetY = e.offsetY;
	}

	function onDragOver(e: DragEvent, day: string, hStart: number) {
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		// Cursor position minus the offset within the block = top of block
		const topY = (e.clientY - rect.top) - dragOffsetY;
		const rawMin = hStart + (topY / CELL_H) * 60;
		dragOverSlot = { day, startMin: snapMin(rawMin) };
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

		// Update local courses array
		const idx = courses.findIndex((c) => c.courseCode === dragCourse!.courseCode && c.component === dragCourse!.component);
		if (idx !== -1) {
			courses[idx] = { ...courses[idx], day, startTime: newStart, endTime: newEnd };
			courses = [...courses];
		}

		// Persist to DB — find which batch this course belongs to
		const course = dragCourse;
		dragCourse = null;

		const batchName = (course.major || '').toUpperCase().split(/[\s,]+/).find((m) => crBatchNames.includes(m)) ?? course.major;
		syncStatus = 'saving';
		try {
			const res = await fetch('/api/cr/schedule', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					courseCode: course.courseCode,
					component: course.component ?? '',
					batch: batchName,
					day,
					startTime: newStart,
					endTime: newEnd,
					courseName: course.courseName,
					faculty: course.faculty,
					room: course.room
				})
			});
			if (res.ok) {
				// Update local overrides map
				const key = `${course.courseCode}|${course.component ?? ''}|${batchName}`;
				scheduleOverrides = new Map(scheduleOverrides).set(key, { day, startTime: newStart, endTime: newEnd });
				syncStatus = 'saved';
				setTimeout(() => (syncStatus = 'idle'), 2000);
			} else {
				syncStatus = 'error';
				setTimeout(() => (syncStatus = 'idle'), 3000);
			}
		} catch {
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
			<span class="hidden text-[9px] uppercase tracking-[0.15em] md:inline" style="color: var(--border);">{data.user.role === 'super_admin' ? 'admin' : data.user.role}</span>
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
			<span class="hidden text-[10px] tracking-wide md:inline" style="color: var(--border);">{data.user.email}</span>
			<button onclick={signOut}
				class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.12em] transition-colors duration-200"
				style="color: var(--border);"
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
						{#if data.crBatch}
							<div class="flex flex-col gap-0.5 border px-3 py-2.5" style="border-color: var(--border);">
								<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">batch</span>
								<span class="text-xs" style="color: var(--fg);">{data.crBatch.name}</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="h-px" style="background: var(--border);"></div>

				<!-- Preference form -->
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
									{@const match = courses.find((c) => c.courseCode.startsWith(item.courseCode))}
									<tr style="border-bottom: 1px solid var(--border);">
										<td class="px-3 py-2.5">
											<span class="font-medium" style="color: var(--fg);">{item.courseCode}</span>
											{#if match}<span class="ml-2 hidden text-[9px] md:inline" style="color: var(--muted);">{match.courseName}</span>{/if}
										</td>
										<td class="px-3 py-2.5" style="color: var(--muted);">{item.p1}/{item.p2}/{item.p3}</td>
										<td class="px-3 py-2.5 font-medium" style="color: var(--fg);">{item.priorityScore}</td>
										<td class="px-3 py-2.5"><span class="inline-block h-2 w-2 rounded-full" style="background: {tColors[level]};"></span></td>
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
					</div>
				{/if}
			</div>

		<!-- ==================== CR: TIMETABLE ==================== -->
		{:else if activeTab === 'timetable'}
			<div class="flex flex-col gap-5">
				<div class="flex items-start justify-between">
					<div>
						<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">weekly schedule</h2>
						<p class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">
							drag to reschedule
							{#if crBatchNames.length}
								— {crBatchNames.join(', ')}
							{/if}
							<span style="color: var(--border);">({crBatchCourses().length} courses)</span>
						</p>
					</div>
					<span class="text-[9px] uppercase tracking-[0.12em] transition-colors duration-200" style="color: {syncStatus === 'saving' ? 'var(--muted)' : syncStatus === 'saved' ? '#4e4' : syncStatus === 'error' ? '#e44' : 'var(--border)'};">
						{syncStatus === 'saving' ? 'saving...' : syncStatus === 'saved' ? 'synced' : syncStatus === 'error' ? 'sync failed' : scheduleOverrides.size ? `${scheduleOverrides.size} overrides` : ''}
					</span>
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
														draggable="true" ondragstart={(e) => onDragStart(e, block.course)}>
														<div class="text-[8px] font-medium truncate" style="color: {block.isUWE ? (level ? tColors[level] : 'var(--fg)') : 'var(--fg)'};">{block.course.courseCode.split('-')[0]}</div>
														<div class="text-[7px] truncate" style="color: var(--muted);">{block.course.courseName}</div>
														{#if h > 32}
															<div class="text-[6px] truncate" style="color: var(--muted);">
																{block.course.component ?? ''}{block.course.room ? ' • ' + block.course.room : ''}{block.course.faculty ? ' • ' + block.course.faculty : ''}
															</div>
														{/if}
													</div>
												{/each}
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
											<span class="text-[7px] ml-0.5" style="color: var(--border);">{item.priorityScore}</span>
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
