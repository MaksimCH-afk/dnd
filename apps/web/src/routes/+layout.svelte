<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { applySettings } from '$lib/settings.svelte';
	import { initRules } from '$lib/rules.svelte';

	let { children } = $props();

	onMount(() => {
		applySettings();
		void initRules();
	});
</script>

{@render children()}
