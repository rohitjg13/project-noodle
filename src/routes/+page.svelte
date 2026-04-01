<script lang="ts">
	import { authClient } from '$lib/auth-client';

	let { data } = $props();

	let viewAsStudent = $state(false);

	const isCR = data.user.role === 'cr';
	const isSuperAdmin = data.user.role === 'super_admin';
	const showCRView = isCR && !viewAsStudent;

	async function signOut() {
		await authClient.signOut();
		window.location.href = '/login';
	}
</script>

<div class="flex min-h-screen flex-col px-8 py-8" style="background: var(--bg);">
	<header class="flex items-center justify-between">
		<div class="flex items-center gap-6">
			<span class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">noodle</span>
			{#if isSuperAdmin}
				<a
					href="/admin"
					class="text-[10px] uppercase tracking-[0.15em] transition-colors duration-200"
					style="color: var(--muted);"
					onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
				>
					admin
				</a>
			{/if}
		</div>
		<div class="flex items-center gap-6">
			{#if isCR}
				<button
					onclick={() => viewAsStudent = !viewAsStudent}
					class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.15em] transition-colors duration-200"
					style="color: {viewAsStudent ? 'var(--accent)' : 'var(--muted)'};"
					onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
					onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = viewAsStudent ? 'var(--accent)' : 'var(--muted)'; }}
				>
					{viewAsStudent ? 'switch to cr view' : 'switch to student view'}
				</button>
			{/if}
			<span class="text-xs tracking-wide" style="color: var(--muted);">{data.user.email}</span>
			<button
				onclick={signOut}
				class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.15em] transition-colors duration-200"
				style="color: var(--border);"
				onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
				onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--border)'; }}
			>
				sign out
			</button>
		</div>
	</header>

	<main class="flex flex-1 flex-col items-center justify-center gap-12">
		<p class="text-xs tracking-[0.2em] uppercase" style="color: var(--muted);">
			welcome, {data.user.name}
		</p>

		<!-- Role badge -->
		<div class="flex items-center gap-2">
			<span
				class="border px-3 py-1 text-[10px] uppercase tracking-[0.15em]"
				style="border-color: var(--border); color: var(--muted);"
			>
				{viewAsStudent ? 'student' : data.user.role.replace('_', ' ')}
			</span>
		</div>

		<!-- Student view section -->
		{#if !showCRView || viewAsStudent}
			<section class="flex w-full max-w-md flex-col gap-4">
				<h2 class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--border);">student</h2>
				<div class="border p-6" style="border-color: var(--border);">
					<p class="text-xs tracking-wide" style="color: var(--muted);">
						{#if data.crBatch}
							your batch: <span style="color: var(--accent);">{data.crBatch.name}</span>
						{:else}
							no batch assigned yet
						{/if}
					</p>
				</div>
			</section>
		{/if}

		<!-- CR view section -->
		{#if showCRView}
			<section class="flex w-full max-w-md flex-col gap-4">
				<h2 class="text-[10px] uppercase tracking-[0.2em]" style="color: var(--border);">cr dashboard</h2>
				{#if data.crBatches && data.crBatches.length > 0}
					{#each data.crBatches as assignment}
						<div class="border p-6" style="border-color: var(--border);">
							<p class="text-xs tracking-wide" style="color: var(--accent);">{assignment.batch.name}</p>
							{#if assignment.batch.description}
								<p class="mt-2 text-[11px]" style="color: var(--muted);">{assignment.batch.description}</p>
							{/if}
							<p class="mt-3 text-[10px] uppercase tracking-[0.1em]" style="color: var(--border);">
								assigned {new Date(assignment.assignedAt).toLocaleDateString()}
							</p>
						</div>
					{/each}
				{:else}
					<div class="border p-6" style="border-color: var(--border);">
						<p class="text-xs tracking-wide" style="color: var(--muted);">no batches assigned yet</p>
					</div>
				{/if}
			</section>
		{/if}
	</main>
</div>
