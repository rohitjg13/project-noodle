<script lang="ts">
	import { authClient } from '$lib/auth-client';

	let loading = $state(false);

	async function signInWithGoogle() {
		loading = true;
		await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
	}
</script>

<div class="fixed inset-0 flex items-center justify-center" style="background: var(--bg);">
	<!-- noise texture overlay -->
	<div class="pointer-events-none fixed inset-0 opacity-[0.03]"
		style="background-image: url('data:image/svg+xml,%3Csvg viewBox=%220 0 256 256%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/%3E%3C/svg%3E'); background-repeat: repeat; background-size: 256px;">
	</div>

	<!-- subtle grid -->
	<div class="pointer-events-none fixed inset-0 opacity-[0.04]"
		style="background-image: linear-gradient(var(--fg) 1px, transparent 1px), linear-gradient(90deg, var(--fg) 1px, transparent 1px); background-size: 60px 60px;">
	</div>

	<div class="relative z-10 flex flex-col items-center gap-16 px-6">
		<!-- brand -->
		<div class="flex flex-col items-center gap-3">
			<h1 class="text-5xl tracking-tight" style="font-family: var(--font-serif); color: var(--accent);">
				noodle
			</h1>
			<div class="h-px w-12" style="background: var(--border);"></div>
		</div>

		<!-- sign in button -->
		<button
			onclick={signInWithGoogle}
			disabled={loading}
			class="group relative cursor-pointer border px-8 py-3.5 text-xs tracking-[0.2em] uppercase transition-all duration-300 hover:tracking-[0.3em] disabled:opacity-30 disabled:cursor-wait"
			style="background: transparent; border-color: var(--border); color: var(--muted);"
			onmouseenter={(e) => { e.currentTarget.style.borderColor = 'var(--muted)'; e.currentTarget.style.color = 'var(--accent)'; }}
			onmouseleave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
		>
			{#if loading}
				<span class="inline-block animate-pulse">authenticating</span>
			{:else}
				continue with google
			{/if}
		</button>

		<!-- footer -->
		<p class="text-[10px] tracking-[0.15em] uppercase" style="color: var(--muted);">
			sign in to continue
		</p>
	</div>
</div>
