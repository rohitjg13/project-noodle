<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let showAssignCR = $state(false);
	let selectedBatches = $state<Set<string>>(new Set());

	function toggleBatch(id: string) {
		const next = new Set(selectedBatches);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedBatches = next;
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
			<a href="/auth/signout" class="linkbtn no-underline">sign out</a>
		</div>
	</header>

	<main class="animate-in mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 md:px-8 md:py-12">
		<div class="flex flex-col gap-1">
			<h1 class="title-xl">Class representatives</h1>
			<p class="hint">Assign students as class reps for one or more batches. CRs can manage demand, constraints, and the timetable for their batches.</p>
		</div>

		{#if form?.error}
			<div class="card flex items-center gap-2 px-4 py-3 text-sm" style="border-color: color-mix(in srgb, #d8593f 45%, var(--border)); color: #d8593f;">
				<span>⚠</span>{form.error}
			</div>
		{/if}
		{#if form?.success}
			<div class="card flex items-center gap-2 px-4 py-3 text-sm" style="border-color: color-mix(in srgb, #3fa463 45%, var(--border)); color: #3fa463;">
				<span>✓</span>
				{#if form.action === 'assignCr'}
					{form.name} is now CR of {form.batch}
				{:else if form.action === 'removeCr'}
					CR assignment removed
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
							<label for="cr-email" class="field-label">Student email</label>
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
								<div class="flex flex-wrap gap-2">
									{#each data.batches as b}
										{#if selectedBatches.has(b.id)}
											<input type="hidden" name="batchIds" value={b.id} />
										{/if}
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
					<p class="hint">Click <span style="color: var(--fg); font-weight: 600;">+ assign CR</span> to give a student class-rep access for their batches.</p>
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
								<div class="mt-3 flex flex-wrap gap-2">
									{#each cr.batches as b}
										<span class="badge" style="color: var(--fg);">
											{b.name}
											<form method="POST" action="?/removeCr" use:enhance class="inline">
												<input type="hidden" name="assignmentId" value={b.assignmentId} />
												<input type="hidden" name="userId" value={cr.user.id} />
												<button
													type="submit"
													class="cursor-pointer border-none bg-transparent text-base leading-none transition-colors duration-200"
													style="color: var(--muted);"
													onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = '#d8593f'; }}
													onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
													aria-label="remove {b.name}"
												>×</button>
											</form>
										</span>
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
