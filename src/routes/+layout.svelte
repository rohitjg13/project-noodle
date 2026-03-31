<script lang="ts">
	import './layout.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>noodle</title>
</svelte:head>

{@render children()}
