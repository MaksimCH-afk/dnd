<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applySettings } from '$lib/settings.svelte';

	let { children } = $props();

	onMount(() => {
		applySettings();
	});
</script>

{@render children()}
