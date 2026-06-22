<script lang="ts">
	import { authClient } from '$lib/auth-client';

	let loading = $state(false);

	async function signInWithGoogle() {
		loading = true;
		await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
	}
</script>

<div class="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6" style="background: var(--bg);">
	<!-- soft accent glow -->
	<div class="pointer-events-none absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full"
		style="background: radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 70%); filter: blur(20px);">
	</div>
	<!-- faint grid -->
	<div class="pointer-events-none absolute inset-0 opacity-[0.05]"
		style="background-image: linear-gradient(var(--fg) 1px, transparent 1px), linear-gradient(90deg, var(--fg) 1px, transparent 1px); background-size: 64px 64px; mask-image: radial-gradient(circle at 50% 40%, black, transparent 75%);">
	</div>
	<!-- grain -->
	<div class="pointer-events-none absolute inset-0 opacity-[0.025]"
		style="background-image: url('data:image/svg+xml,%3Csvg viewBox=%220 0 256 256%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/%3E%3C/svg%3E'); background-size: 220px;">
	</div>

	<main class="animate-in relative z-10 flex w-full max-w-sm flex-col items-center text-center">
		<span class="eyebrow mb-6">Course &amp; timetable planner</span>

		<h1 class="title-xl" style="font-size: clamp(3rem, 12vw, 4rem);">noodle</h1>

		<p class="hint mt-4 max-w-xs" style="font-size: 0.9rem;">
			Pick your electives, spot clashes before they happen, and let your class rep
			arrange the weekly timetable — all in one place.
		</p>

		<div class="my-9 h-px w-12" style="background: var(--border);"></div>

		<button onclick={signInWithGoogle} disabled={loading} class="btn btn-primary btn-block" style="padding-top: 0.85rem; padding-bottom: 0.85rem;">
			{#if loading}
				<span class="animate-pulse">Signing you in…</span>
			{:else}
				<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
					<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
					<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
					<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
					<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
				</svg>
				Continue with Google
			{/if}
		</button>

		<p class="eyebrow mt-6" style="font-size: 0.6rem; letter-spacing: 0.14em;">
			Sign in with your college account
		</p>
	</main>

	<footer class="absolute bottom-0 left-0 right-0 z-10 py-5 text-center">
		<span class="eyebrow" style="font-size: 0.58rem;">
			built &amp; maintained by
			<a href="https://github.com/rohitjg13" target="_blank" rel="noopener noreferrer"
				class="underline decoration-1 underline-offset-4 transition-colors"
				style="color: var(--muted);"
				onmouseenter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
				onmouseleave={(e) => (e.currentTarget.style.color = 'var(--muted)')}>rohit j g</a>
		</span>
	</footer>
</div>
