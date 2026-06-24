<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applySettings } from '$lib/settings.svelte';
	import { initRules } from '$lib/rules.svelte';
	import { initLogs } from '$lib/logbus.svelte';

	let { children } = $props();

	onMount(() => {
		applySettings();
		void initRules();
		void initLogs();
	});
</script>

{@render children()}
