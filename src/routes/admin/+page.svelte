<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let showAssignCR = $state(false);
	let selectedBatches = $state<Set<string>>(new Set());
	let batchFilter = $state('');

	// Editing an existing CR's batches — one card at a time
	let editingCr = $state<string | null>(null);
	let editBatches = $state<Set<string>>(new Set());
	let editFilter = $state('');

	function toggleBatch(id: string) {
		const next = new Set(selectedBatches);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedBatches = next;
	}

	function startEdit(cr: { user: { id: string }; batches: { id: string }[] }) {
		editingCr = cr.user.id;
		editBatches = new Set(cr.batches.map((b) => b.id));
		editFilter = '';
	}

	function toggleEditBatch(id: string) {
		const next = new Set(editBatches);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		editBatches = next;
	}

	// 160+ batches in the file, so both pickers filter
	function matchBatches(all: { id: string; name: string }[], q: string) {
		const needle = q.trim().toUpperCase();
		return needle ? all.filter((b) => b.name.toUpperCase().includes(needle)) : all;
	}
</script>

<div class="flex min-h-dvh flex-col" style="background: var(--bg);">
	<header class="flex items-center justify-between gap-3 px-4 py-3 md:px-8 md:py-4" style="border-bottom: 1px solid var(--border);">
		<a href="/" class="flex items-center gap-2.5 no-underline">
			<span class="grid h-7 w-7 place-items-center rounded-md" style="background: var(--accent); color: var(--on-accent); font-family: var(--font-serif); font-weight: 700; font-size: 1.25rem; line-height: 1;">n</span>
			<span class="title-md" style="font-size: 1.35rem;">noodle</span>
			<span class="badge ml-1">admin</span>
		</a>
		<div class="flex items-center gap-3">
			<a href="/" class="linkbtn no-underline">← back</a>
			<form method="POST" action="/auth/signout" class="contents">
				<button type="submit" class="linkbtn">sign out</button>
			</form>
		</div>
	</header>

	<main class="animate-in mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
		<div class="flex flex-col gap-1">
			<h1 class="title-xl">Class representatives</h1>
			<p class="hint">Assign students as class reps for one or more batches. CRs can manage demand, track courses, set professor constraints, and rearrange the timetable for their batches.</p>
		</div>

		{#if form?.error}
			<div class="card flex items-center gap-2 px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); color: var(--danger);">
				<span>⚠</span>{form.error}
			</div>
		{/if}
		{#if form?.success}
			<div class="card flex items-center gap-2 px-4 py-3 text-sm" style="border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); color: var(--ok);">
				<span>✓</span>
				{#if form.action === 'assignCr'}
					Added CR — {form.name} now manages {form.batch}
				{:else if form.action === 'invite'}
					Invited {form.name} — they become CR of {form.batch} the first time they sign in
				{:else if form.action === 'setCrBatches'}
					{form.batch ? `Updated ${form.name} — now manages ${form.batch}` : `${form.name} no longer manages any batch`}
				{:else if form.action === 'removeInvite'}
					Invitation withdrawn
				{:else if form.action === 'removeCr'}
					CR assignment removed
				{:else}
					Saved
				{/if}
			</div>
		{/if}

		<div class="grid gap-6 lg:grid-cols-2 lg:items-start">
			<!-- Assign CR -->
			<section class="flex flex-col gap-4">
				<div class="flex items-center justify-between">
					<h2 class="title-md">Add a CR</h2>
					<button
						onclick={() => { showAssignCR = !showAssignCR; selectedBatches = new Set(); }}
						class="btn {showAssignCR ? 'btn-ghost' : 'btn-primary'} btn-sm"
					>
						{showAssignCR ? 'cancel' : '+ assign CR'}
					</button>
				</div>

				{#if showAssignCR}
					<form
						method="POST"
						action="?/assignCr"
						use:enhance={() => ({ update }) => { update(); showAssignCR = false; selectedBatches = new Set(); }}
						class="card card-pad flex flex-col gap-5"
					>
						<div class="flex flex-col">
							<label for="cr-email" class="field-label">Email <span style="color: var(--muted); font-weight: 400;">— an account isn't needed yet</span></label>
							<input
								id="cr-email"
								name="email"
								type="email"
								required
								placeholder="student@example.com"
								class="input"
							/>
						</div>

						<div class="flex flex-col gap-3">
							<span class="field-label" style="margin-bottom: 0;">
								Batches <span style="color: var(--muted); font-weight: 400;">({data.batches.length} loaded)</span>
							</span>

							{#if data.batches.length === 0}
								<p class="hint">No batches found in the timetable file.</p>
							{:else}
								<input
									bind:value={batchFilter}
									placeholder="filter batches"
									autocomplete="off"
									class="input nood-mono uppercase"
									style="font-size: 0.8rem; padding: 0.5rem 0.7rem;"
								/>
								<!-- Hidden inputs cover every selection, including ones the filter hides -->
								{#each [...selectedBatches] as id}
									<input type="hidden" name="batchIds" value={id} />
								{/each}
								<div class="flex flex-wrap gap-2" style="max-height: 13rem; overflow-y: auto;">
									{#each matchBatches(data.batches, batchFilter) as b}
										<button
											type="button"
											onclick={() => toggleBatch(b.id)}
											class="chip {selectedBatches.has(b.id) ? 'chip-active' : ''}"
											aria-pressed={selectedBatches.has(b.id)}
										>
											{b.name}
										</button>
									{/each}
								</div>
								<p class="hint">{selectedBatches.size} selected</p>
							{/if}
						</div>

						<button type="submit" disabled={selectedBatches.size === 0} class="btn btn-primary">
							assign as CR
						</button>
					</form>
				{:else}
					<p class="hint">Click <span style="color: var(--fg); font-weight: 600;">+ assign CR</span> to give a student class-rep access for their batches. If they haven't signed in yet, the access is waiting for them when they do.</p>
				{/if}
			</section>

			<!-- CR list grouped by user -->
			<section class="flex flex-col gap-3">
				<span class="eyebrow">Current CRs ({data.crs.length})</span>
				{#if data.crs.length === 0}
					<div class="card card-pad text-center">
						<p class="hint">No CRs assigned yet.</p>
					</div>
				{:else}
					<div class="flex flex-col gap-3">
						{#each data.crs as cr}
							<div class="card card-pad">
								<p class="text-base font-semibold" style="color: var(--fg);">{cr.user.name}</p>
								<p class="mt-0.5 text-sm" style="color: var(--muted);">{cr.user.email}</p>
								<div class="mt-3 flex flex-wrap items-center gap-2">
									{#each cr.batches as b}
										<span class="badge" style="color: var(--fg);">
											{b.name}
											<form method="POST" action="?/removeCr" use:enhance class="inline">
												<input type="hidden" name="assignmentId" value={b.assignmentId} />
												<button
													type="submit"
													class="cursor-pointer border-none bg-transparent text-base leading-none transition-colors duration-200"
													style="color: var(--muted);"
													onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--danger)'; }}
													onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
													aria-label="remove {b.name}"
												>×</button>
											</form>
										</span>
									{/each}
									{#if editingCr !== cr.user.id}
										<button onclick={() => startEdit(cr)} class="linkbtn">edit batches</button>
									{/if}
								</div>

								{#if editingCr === cr.user.id}
									<form
										method="POST"
										action="?/setCrBatches"
										use:enhance={() => ({ update }) => { update(); editingCr = null; }}
										class="mt-3 flex flex-col gap-2.5 pt-3"
										style="border-top: 1px solid var(--border);"
									>
										<input type="hidden" name="userId" value={cr.user.id} />
										{#each [...editBatches] as id}
											<input type="hidden" name="batchIds" value={id} />
										{/each}
										<input
											bind:value={editFilter}
											placeholder="filter batches"
											autocomplete="off"
											class="input nood-mono uppercase"
											style="font-size: 0.8rem; padding: 0.5rem 0.7rem;"
										/>
										<div class="flex flex-wrap gap-2" style="max-height: 11rem; overflow-y: auto;">
											{#each matchBatches(data.batches, editFilter) as b}
												<button
													type="button"
													onclick={() => toggleEditBatch(b.id)}
													class="chip {editBatches.has(b.id) ? 'chip-active' : ''}"
													aria-pressed={editBatches.has(b.id)}
												>{b.name}</button>
											{/each}
										</div>
										<div class="flex items-center gap-3">
											<p class="hint">{editBatches.size} selected{editBatches.size === 0 ? ' — saving none removes their CR access' : ''}</p>
											<div class="flex-1"></div>
											<button type="button" onclick={() => editingCr = null} class="btn btn-ghost btn-sm">cancel</button>
											<button type="submit" class="btn btn-primary btn-sm">save batches</button>
										</div>
									</form>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				{#if data.invites.length}
					<div class="flex flex-col gap-3 pt-2">
						<span class="eyebrow">Invited — waiting for first sign-in ({data.invites.length})</span>
						{#each data.invites as invite}
							<div class="card card-pad" style="border-style: dashed;">
								<div class="flex items-start justify-between gap-3">
									<p class="min-w-0 truncate text-sm font-semibold" style="color: var(--fg);">{invite.email}</p>
									<form method="POST" action="?/removeInvite" use:enhance>
										<input type="hidden" name="email" value={invite.email} />
										<button type="submit" class="linkbtn shrink-0">withdraw</button>
									</form>
								</div>
								<div class="mt-2.5 flex flex-wrap gap-2">
									{#each invite.batches as b}
										<span class="badge">{b.name}</span>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	</main>

	<footer class="border-t py-5 text-center" style="border-color: var(--border); background: var(--bg);">
		<span class="eyebrow" style="font-size: 0.6rem;">built &amp; maintained by
			<a href="https://github.com/rohitjg13" target="_blank" rel="noopener noreferrer" class="underline decoration-1 underline-offset-4 transition-colors" style="color: var(--muted);"
				onmouseenter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--accent)'; }}
				onmouseleave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--muted)'; }}
			>rohit j g</a>
		</span>
	</footer>
</div>
