<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let showCreateBatch = $state(false);
	let showAssignCR = $state(false);
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
			<span class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--border);">
				/ admin
			</span>
		</div>
	</header>

	<main class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-12 py-12">

		<!-- Feedback banner -->
		{#if form?.error}
			<div class="border px-4 py-3 text-xs tracking-wide" style="border-color: var(--accent); color: var(--accent);">
				{form.error}
			</div>
		{/if}
		{#if form?.success}
			<div class="border px-4 py-3 text-xs tracking-wide" style="border-color: var(--muted); color: var(--muted);">
				{#if form.action === 'assignCr'}
					{form.name} is now CR of {form.batch}
				{:else if form.action === 'createBatch'}
					batch created
				{:else if form.action === 'removeCr'}
					cr assignment removed
				{/if}
			</div>
		{/if}

		<!-- Batches -->
		<section class="flex flex-col gap-6">
			<div class="flex items-center justify-between">
				<h2 class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--border);">batches</h2>
				<button
					onclick={() => showCreateBatch = !showCreateBatch}
					class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.15em] transition-colors duration-200"
					style="color: var(--muted);"
					onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
				>
					{showCreateBatch ? 'cancel' : '+ new batch'}
				</button>
			</div>

			{#if showCreateBatch}
				<form
					method="POST"
					action="?/createBatch"
					use:enhance={() => {
						return ({ update }) => {
							update();
							showCreateBatch = false;
						};
					}}
					class="flex flex-col gap-4 border p-6"
					style="border-color: var(--border);"
				>
					<div class="flex flex-col gap-2">
						<label for="batch-name" class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--muted);">
							batch name
						</label>
						<input
							id="batch-name"
							name="name"
							type="text"
							required
							placeholder="e.g. CSE 2024 Section A"
							class="border bg-transparent px-3 py-2 text-xs tracking-wide outline-none transition-colors duration-200 focus:border-current"
							style="border-color: var(--border); color: var(--fg);"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label for="batch-desc" class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--muted);">
							description <span style="color: var(--border);">(optional)</span>
						</label>
						<input
							id="batch-desc"
							name="description"
							type="text"
							placeholder="brief description"
							class="border bg-transparent px-3 py-2 text-xs tracking-wide outline-none transition-colors duration-200 focus:border-current"
							style="border-color: var(--border); color: var(--fg);"
						/>
					</div>
					<button
						type="submit"
						class="cursor-pointer border px-6 py-2.5 text-[10px] uppercase tracking-[0.2em] transition-all duration-300"
						style="border-color: var(--muted); color: var(--muted); background: transparent;"
						onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
						onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--muted)'; }}
					>
						create batch
					</button>
				</form>
			{/if}

			{#if data.batches.length === 0}
				<p class="text-xs tracking-wide" style="color: var(--border);">no batches yet</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each data.batches as b}
						<div class="flex items-center justify-between border px-4 py-3" style="border-color: var(--border);">
							<div>
								<p class="text-xs tracking-wide" style="color: var(--fg);">{b.name}</p>
								{#if b.description}
									<p class="mt-1 text-[11px]" style="color: var(--muted);">{b.description}</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Assign CR -->
		<section class="flex flex-col gap-6">
			<div class="flex items-center justify-between">
				<h2 class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--border);">assign cr</h2>
				<button
					onclick={() => showAssignCR = !showAssignCR}
					class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.15em] transition-colors duration-200"
					style="color: var(--muted);"
					onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
				>
					{showAssignCR ? 'cancel' : '+ assign'}
				</button>
			</div>

			{#if showAssignCR}
				<form
					method="POST"
					action="?/assignCr"
					use:enhance={() => {
						return ({ update }) => {
							update();
							showAssignCR = false;
						};
					}}
					class="flex flex-col gap-4 border p-6"
					style="border-color: var(--border);"
				>
					<div class="flex flex-col gap-2">
						<label for="cr-email" class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--muted);">
							email
						</label>
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
					<div class="flex flex-col gap-2">
						<label for="cr-batch" class="text-[10px] uppercase tracking-[0.15em]" style="color: var(--muted);">
							batch
						</label>
						{#if data.batches.length === 0}
							<p class="text-[11px]" style="color: var(--border);">create a batch first</p>
						{:else}
							<select
								id="cr-batch"
								name="batchId"
								required
								class="border bg-transparent px-3 py-2 text-xs tracking-wide outline-none transition-colors duration-200"
								style="border-color: var(--border); color: var(--fg);"
							>
								<option value="" style="background: var(--bg);">select a batch</option>
								{#each data.batches as b}
									<option value={b.id} style="background: var(--bg);">{b.name}</option>
								{/each}
							</select>
						{/if}
					</div>
					{#if data.batches.length > 0}
						<button
							type="submit"
							class="cursor-pointer border px-6 py-2.5 text-[10px] uppercase tracking-[0.2em] transition-all duration-300"
							style="border-color: var(--muted); color: var(--muted); background: transparent;"
							onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
							onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--muted)'; }}
						>
							assign as cr
						</button>
					{/if}
				</form>
			{/if}

			<!-- Current CRs -->
			{#if data.crs.length === 0}
				<p class="text-xs tracking-wide" style="color: var(--border);">no crs assigned yet</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each data.crs as cr}
						<div class="flex items-center justify-between border px-4 py-3" style="border-color: var(--border);">
							<div>
								<p class="text-xs tracking-wide" style="color: var(--fg);">{cr.user.name}</p>
								<p class="text-[11px]" style="color: var(--muted);">{cr.user.email}</p>
								<p class="mt-1 text-[10px] uppercase tracking-[0.1em]" style="color: var(--border);">
									{cr.batch.name}
								</p>
							</div>
							<form method="POST" action="?/removeCr" use:enhance>
								<input type="hidden" name="assignmentId" value={cr.assignmentId} />
								<input type="hidden" name="userId" value={cr.user.id} />
								<button
									type="submit"
									class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.1em] transition-colors duration-200"
									style="color: var(--border);"
									onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
									onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--border)'; }}
								>
									remove
								</button>
							</form>
						</div>
					{/each}
				</div>
			{/if}
		</section>

	</main>
</div>
