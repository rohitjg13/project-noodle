<script lang="ts">
	import { authClient } from '$lib/auth-client';

	let { data } = $props();

	async function signOut() {
		await authClient.signOut();
		window.location.href = '/login';
	}
</script>

<div class="flex min-h-screen flex-col px-8 py-8" style="background: var(--bg);">
	<header class="flex items-center justify-between">
		<span class="text-lg" style="font-family: var(--font-serif); color: var(--accent);">noodle</span>
		<div class="flex items-center gap-6">
			<span class="text-xs tracking-wide" style="color: var(--muted);">{data.user.email}</span>
			<button
				onclick={signOut}
				class="cursor-pointer border-none bg-transparent text-[10px] uppercase tracking-[0.15em] transition-colors duration-200"
				style="color: var(--border);"
				onmouseenter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
				onmouseleave={(e) => { e.currentTarget.style.color = 'var(--border)'; }}
			>
				sign out
			</button>
		</div>
	</header>

	<main class="flex flex-1 items-center justify-center">
		<p class="text-xs tracking-[0.2em] uppercase" style="color: var(--muted);">
			welcome, {data.user.name}
		</p>
	</main>
</div>
