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
	let dragOverSlot = $state<{ day: string; startMin: number } | null>(null);
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

	// Calendar
	const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
	let calendarCourses = $derived(
		coreCourses.filter((c) => {
			const b = data.crBatch?.name;
			if (!b || !c.major) return false;
			const majors = c.major.toUpperCase().split(/[\s,]+/);
			return majors.some((m) => m.includes(b.toUpperCase()) || b.toUpperCase().includes(m));
		})
	);
	let calendarBlocks = $derived(() => {
		const blocks: { course: Course; day: string; startMin: number; endMin: number }[] = [];
		for (const c of calendarCourses) {
			const days = parseDays(c.day || '');
			const s = timeToMinutes(c.startTime || '');
			const e = timeToMinutes(c.endTime || '');
			if (s >= e) continue;
			for (const d of days) blocks.push({ course: c, day: d, startMin: s, endMin: e });
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

	// Drag and drop
	function onDragStart(course: Course) { dragCourse = course; }
	function onDragOver(e: DragEvent, day: string, startMin: number) { e.preventDefault(); dragOverSlot = { day, startMin }; }
	function onDrop(e: DragEvent, day: string, hourMin: number) {
		e.preventDefault(); dragOverSlot = null;
		if (!dragCourse) return;
		const dur = timeToMinutes(dragCourse.endTime || '') - timeToMinutes(dragCourse.startTime || '');
		const msg = isConstrained(day, hourMin, hourMin + dur);
		if (msg) { showToast(msg); dragCourse = null; return; }
		const idx = courses.findIndex((c) => c.courseCode === dragCourse!.courseCode && c.day === dragCourse!.day);
		if (idx !== -1) { courses[idx] = { ...courses[idx], day, startTime: minutesToTime(hourMin), endTime: minutesToTime(hourMin + dur) }; courses = [...courses]; }
		dragCourse = null;
	}

	async function signOut() { await authClient.signOut(); window.location.href = '/login'; }

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
				<div>
					<h2 class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">weekly schedule</h2>
					<p class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">drag to reschedule{data.crBatch ? ` — ${data.crBatch.name}` : ''}</p>
				</div>

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
									<div class="relative px-0.5 text-right" style="height: 56px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border);">
										<span class="text-[7px]" style="color: var(--muted);">{label}</span>
									</div>
									{#each DAYS as day}
										{@const hStart = mins}
										{@const hEnd = mins + 60}
										{@const cMsg = isConstrained(day, hStart, hEnd)}
										<div class="relative" style="height: 56px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); {cMsg ? 'background: rgba(255,255,255,0.02);' : ''}"
											role="cell" tabindex="-1"
											ondragover={(e) => onDragOver(e, day, hStart)}
											ondrop={(e) => onDrop(e, day, hStart)}>
											{#if cMsg}<div class="absolute inset-0 flex items-center justify-center opacity-15"><span class="text-[7px] uppercase" style="color: var(--muted);">locked</span></div>{/if}
											{#each calendarBlocks().filter((b) => b.day === day && b.startMin >= hStart && b.startMin < hEnd) as block}
												{@const top = ((block.startMin - hStart) / 60) * 100}
												{@const h = ((block.endMin - block.startMin) / 60) * 56}
												<div role="button" tabindex="0"
													class="absolute left-0.5 right-0.5 overflow-hidden px-1 py-0.5 cursor-grab active:cursor-grabbing"
													style="top: {top}%; height: {h}px; min-height: 24px; background: var(--surface); border: 1px solid var(--border); z-index: 2;"
													draggable="true" ondragstart={() => onDragStart(block.course)}>
													<div class="text-[8px] font-medium truncate" style="color: var(--fg);">{block.course.courseCode.split('-')[0]}</div>
													<div class="text-[7px] truncate" style="color: var(--muted);">{block.course.courseName}</div>
												</div>
											{/each}
											{#if dragOverSlot?.day === day && dragOverSlot?.startMin === hStart}
												<div class="absolute inset-0.5" style="border: 1px dashed var(--muted); z-index: 1;"></div>
											{/if}
										</div>
									{/each}
								{/if}
							{/each}
						</div>
					</div>
				</div>

				<!-- Top UWEs panel -->
				<div class="flex flex-col gap-2 pt-3" style="border-top: 1px solid var(--border);">
					<span class="text-[9px] uppercase tracking-[0.1em]" style="color: var(--muted);">high priority uwes</span>
					<div class="grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-3">
						{#each demand.slice(0, 9) as item}
							{@const level = getTrafficLight(item.courseCode)}
							<div class="flex items-center gap-2 border px-2.5 py-2" style="border-color: var(--border);">
								<span class="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full" style="background: {tColors[level]};"></span>
								<span class="text-[10px] font-medium truncate" style="color: var(--fg);">{item.courseCode}</span>
								<span class="ml-auto flex-shrink-0 text-[8px]" style="color: var(--muted);">{item.total}</span>
							</div>
						{/each}
					</div>
				</div>
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
