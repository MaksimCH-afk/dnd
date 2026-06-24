<script lang="ts">
	import { onMount } from 'svelte';
	import Chronicle from '$lib/components/Chronicle.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import StatusThread from '$lib/components/StatusThread.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import CampaignsPanel from '$lib/components/CampaignsPanel.svelte';
	import ReferencePanel from '$lib/components/ReferencePanel.svelte';
	import CreationWizard from '$lib/components/CreationWizard.svelte';
	import OnboardingWizard from '$lib/components/OnboardingWizard.svelte';
	import Ledger from '$lib/components/Ledger.svelte';
	import { settings } from '$lib/settings.svelte';
	import { session, sendTurn, createCampaign, openCampaign, saveGame, checkConnection } from '$lib/session.svelte';
	import { threadModel, statusFields } from '$lib/status';
	import type { CreationChoices } from '@rpg/engine';

	let showSettings = $state(false);
	let showCampaigns = $state(false);
	let showReference = $state(false);
	let showCreation = $state(false);
	let showOnboarding = $state(false);
	let ledgerOpen = $state(true);

	const thread = $derived(session.state ? threadModel(session.state) : { intensity: 0.2, tone: 'accent' as const, pulse: false, label: '' });
	const topStatus = $derived(session.state ? statusFields(session.state) : []);

	onMount(() => {
		void (async () => {
			await checkConnection();
			if (!settings.onboarded) showOnboarding = true;
		})();
	});

	function addSystem(text: string) {
		session.entries.push({ id: `sys${Date.now()}-${Math.round(Math.random() * 1e6)}`, speaker: 'system', text });
	}

	async function handleSend(text: string) {
		if (text.startsWith('/save')) {
			addSystem('⊙ ' + (await saveGame()));
			return;
		}
		if (text.startsWith('/go')) {
			if (!session.campaignId) {
				addSystem('Игра не начата. Откройте кампанию (📚) или начните новую.');
				return;
			}
			await openCampaign(session.campaignId); // подтянуть актуальное состояние с сервера
			addSystem('⊙ Состояние подтянуто с сервера.');
			return;
		}
		if (text.startsWith('/ask')) {
			addSystem('/ask: мета-режим читает серверный лог хода (раздел 22). Подключение окна — следующим шагом.');
			return;
		}
		if (!session.campaignId) {
			addSystem('Сначала начните игру: «Новая игра» в гроссбухе или 📚.');
			return;
		}
		await sendTurn(text);
	}

	async function onCreated(choices: CreationChoices) {
		showCreation = false;
		try {
			await createCampaign(choices);
		} catch (e) {
			addSystem(`⚠ Не удалось создать кампанию: ${(e as Error).message}`);
		}
	}
</script>

<svelte:head><title>Текстовое НРИ</title></svelte:head>

<div class="app">
	<header class="topbar">
		<button class="icon" onclick={() => (ledgerOpen = !ledgerOpen)} aria-label="Гроссбух">☰</button>
		<div class="scene mono">
			<span class="sync" class:on={session.connected} title={session.connected ? 'Сервер на связи' : 'Нет связи с сервером'}>⊙</span>
			{#if topStatus.length}
				{#each topStatus.slice(0, 4) as f (f.label)}<span class="chip">{f.label} {f.value}</span>{/each}
			{:else}
				Пролог
			{/if}
		</div>
		<button class="icon" onclick={() => (showCampaigns = true)} aria-label="Кампании" title="Кампании">📚</button>
		<button class="icon" onclick={() => (showReference = true)} aria-label="Справка по моделям" title="Справка: платные модели на роль Ведущего">💳</button>
		<button class="icon" onclick={() => (showSettings = true)} aria-label="Настройки">⚙</button>
	</header>

	<main class="layout" class:ledger-open={ledgerOpen}>
		<section class="chronicle-col">
			<Chronicle entries={session.entries} />
			<Composer busy={session.busy} onsend={handleSend} />
		</section>

		<StatusThread intensity={session.busy ? Math.min(1, thread.intensity + 0.2) : thread.intensity} tone={thread.tone} pulse={thread.pulse || session.busy} />

		<aside class="ledger" hidden={!ledgerOpen}>
			{#if session.state}
				<Ledger state={session.state} />
				{#if thread.label}
					<div class="thread-legend mono"><span>нить состояния</span><small>{thread.label}</small></div>
				{/if}
			{:else}
				<div class="empty-ledger">
					<h2 class="mono">Гроссбух</h2>
					<p>Игра не начата.</p>
					<button class="newgame" onclick={() => (showCreation = true)}>Новая игра</button>
					<button class="link" onclick={() => (showCampaigns = true)}>Открыть кампанию</button>
				</div>
			{/if}
		</aside>
	</main>
</div>

{#if showSettings}<SettingsPanel onclose={() => (showSettings = false)} />{/if}
{#if showCampaigns}
	<CampaignsPanel
		onclose={() => (showCampaigns = false)}
		onnew={() => { showCampaigns = false; showCreation = true; }}
		onpicked={() => (showCampaigns = false)}
	/>
{/if}
{#if showReference}<ReferencePanel onclose={() => (showReference = false)} />{/if}
{#if showCreation}<CreationWizard oncreated={onCreated} oncancel={() => (showCreation = false)} />{/if}
{#if showOnboarding}
	<OnboardingWizard
		onnew={() => { showOnboarding = false; showCreation = true; }}
		onload={() => { showOnboarding = false; showCampaigns = true; }}
		onclose={() => (showOnboarding = false)}
	/>
{/if}

<style>
	.app { height: 100dvh; display: flex; flex-direction: column; }
	.topbar { display: flex; align-items: center; gap: .6rem; padding: .5rem var(--gutter); border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0; }
	.topbar .scene { flex: 1; display: flex; gap: .4rem; justify-content: center; flex-wrap: wrap; color: var(--text-dim); font-size: .78em; overflow: hidden; align-items: center; }
	.chip { white-space: nowrap; padding: .1rem .5rem; background: var(--surface-raised); border: 1px solid var(--border); border-radius: 999px; }
	.sync { color: var(--danger); opacity: .7; }
	.sync.on { color: var(--accent); }
	.icon { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; padding: .2rem .4rem; }
	.icon:hover { color: var(--accent); }
	.layout { flex: 1; display: grid; grid-template-columns: 1fr auto; min-height: 0; }
	.layout.ledger-open { grid-template-columns: 1fr auto minmax(240px, 320px); }
	.chronicle-col { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
	.ledger { border-left: 1px solid var(--border); background: var(--surface); padding: 1.2rem; overflow-y: auto; }
	.empty-ledger { color: var(--text-dim); text-align: center; margin-top: 2rem; }
	.empty-ledger h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }
	.newgame { display: block; width: 100%; margin: 1rem 0 .6rem; background: var(--accent); color: var(--ink-900); border: none; border-radius: var(--radius); padding: .6rem 1.2rem; font-size: .95em; }
	.link { background: none; border: none; color: var(--link); text-decoration: underline; font-size: .85em; cursor: pointer; }
	.thread-legend { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: .3rem; font-size: .72em; color: var(--accent); }
	.thread-legend small { color: var(--text-dim); }
	@media (max-width: 760px) {
		.layout.ledger-open { grid-template-columns: 1fr auto; }
		.ledger { position: fixed; top: 0; right: 0; bottom: 0; width: min(85vw, 320px); z-index: 5; box-shadow: -8px 0 30px rgba(0,0,0,.4); }
	}
</style>
