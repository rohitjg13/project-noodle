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

<div class="flex min-h-screen flex-col px-8 py-8" style="background: var(--bg);">
	<header class="flex items-center justify-between">
		<div class="flex items-center gap-6">
			<a
				href="/"
				class="text-lg transition-colors duration-200"
				style="font-family: var(--font-serif); color: var(--accent);"
			>
				noodle
			</a>
			<span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--muted);">
				/ admin
			</span>
		</div>
		<a href="/auth/signout"
			class="text-[10px] uppercase tracking-[0.12em] no-underline transition-colors duration-200"
			style="color: var(--muted);"
			onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
			onmouseleave={(e) => { e.currentTarget.style.color = 'var(--muted)'; }}
		>sign out</a>
	</header>

	<main class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-12 py-12">

		{#if form?.error}
			<div class="border px-4 py-3 text-xs tracking-wide" style="border-color: var(--accent); color: var(--accent);">
				{form.error}
			</div>
		{/if}
		{#if form?.success}
			<div class="border px-4 py-3 text-xs tracking-wide" style="border-color: var(--muted); color: var(--muted);">
				{#if form.action === 'assignCr'}
					{form.name} is now CR of {form.batch}
				{:else if form.action === 'removeCr'}
					cr assignment removed
				{/if}
			</div>
		{/if}

		<!-- Assign CR -->
		<section class="flex flex-col gap-6">
			<div class="flex items-center justify-between">
				<h2 class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--muted);">class representatives</h2>
				<button
					onclick={() => { showAssignCR = !showAssignCR; selectedBatches = new Set(); }}
					class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.15em] transition-colors duration-200"
					style="color: var(--muted);"
					onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
				>
					{showAssignCR ? 'cancel' : '+ assign cr'}
				</button>
			</div>

			{#if showAssignCR}
				<form
					method="POST"
					action="?/assignCr"
					use:enhance={() => ({ update }) => { update(); showAssignCR = false; selectedBatches = new Set(); }}
					class="flex flex-col gap-5 border p-6"
					style="border-color: var(--border);"
				>
					<div class="flex flex-col gap-2">
						<label for="cr-email" class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--muted);">email</label>
						<input
							id="cr-email"
							name="email"
							type="email"
							required
							placeholder="student@example.com"
							class="border bg-transparent px-3 py-2 text-xs tracking-wide outline-none transition-colors duration-200 focus:border-current"
							style="border-color: var(--border); color: var(--fg);"
						/>
					</div>

					<div class="flex flex-col gap-3">
						<span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--muted);">
							batches <span style="color: var(--muted);">({data.batches.length} loaded)</span>
						</span>

						{#if data.batches.length === 0}
							<p class="text-[11px]" style="color: var(--muted);">no batches in timetable file</p>
						{:else}
							<div
								class="grid gap-x-4 gap-y-2 border p-4"
								style="border-color: var(--border); grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));"
							>
								{#each data.batches as b}
									{#if selectedBatches.has(b.id)}
										<input type="hidden" name="batchIds" value={b.id} />
									{/if}
									<label
										class="flex cursor-pointer items-center gap-2 text-[11px] tracking-wide transition-colors duration-150"
										style="color: {selectedBatches.has(b.id) ? 'var(--fg)' : 'var(--muted)'};"
									>
										<span
											class="flex h-3 w-3 shrink-0 items-center justify-center border transition-colors duration-150"
											style="border-color: {selectedBatches.has(b.id) ? 'var(--accent)' : 'var(--border)'}; background: {selectedBatches.has(b.id) ? 'var(--accent)' : 'transparent'};"
											onclick={() => toggleBatch(b.id)}
											role="checkbox"
											aria-checked={selectedBatches.has(b.id)}
											tabindex="0"
											onkeydown={(e) => e.key === ' ' && toggleBatch(b.id)}
										>
											{#if selectedBatches.has(b.id)}
												<svg width="7" height="7" viewBox="0 0 8 8" fill="none">
													<path d="M1 4L3 6L7 2" stroke="var(--bg)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
												</svg>
											{/if}
										</span>
										{b.name}
									</label>
								{/each}
							</div>
							<p class="text-[10px]" style="color: var(--muted);">{selectedBatches.size} selected</p>
						{/if}
					</div>

					<button
						type="submit"
						disabled={selectedBatches.size === 0}
						class="cursor-pointer border px-6 py-2.5 text-[10px] uppercase tracking-[0.2em] transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-30"
						style="border-color: var(--muted); color: var(--muted); background: transparent;"
						onmouseenter={(e) => { if (selectedBatches.size > 0) { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; } }}
						onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--muted)'; }}
					>
						assign as cr
					</button>
				</form>
			{/if}

			<!-- CR list grouped by user -->
			{#if data.crs.length === 0}
				<p class="text-xs tracking-wide" style="color: var(--muted);">no crs assigned yet</p>
			{:else}
				<div class="flex flex-col gap-3">
					{#each data.crs as cr}
						<div class="border px-4 py-4" style="border-color: var(--border);">
							<p class="text-xs tracking-wide" style="color: var(--fg);">{cr.user.name}</p>
							<p class="mt-0.5 text-[11px]" style="color: var(--muted);">{cr.user.email}</p>
							<div class="mt-3 flex flex-wrap gap-2">
								{#each cr.batches as b}
									<span
										class="flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.1em]"
										style="border-color: var(--border); color: var(--muted);"
									>
										{b.name}
										<form method="POST" action="?/removeCr" use:enhance class="inline">
											<input type="hidden" name="assignmentId" value={b.assignmentId} />
											<input type="hidden" name="userId" value={cr.user.id} />
											<button
												type="submit"
												class="cursor-pointer border-none bg-transparent text-sm leading-none transition-colors duration-200"
												style="color: var(--muted);"
												onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
												onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--border)'; }}
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

	</main>
</div>
