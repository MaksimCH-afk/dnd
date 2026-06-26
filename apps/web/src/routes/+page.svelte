<script lang="ts">
	import { onMount } from 'svelte';
	import Chronicle from '$lib/components/Chronicle.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import StatusThread from '$lib/components/StatusThread.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import CampaignsPanel from '$lib/components/CampaignsPanel.svelte';
	import ReferencePanel from '$lib/components/ReferencePanel.svelte';
	import CreationWizard from '$lib/components/CreationWizard.svelte';
	import ImportWizard from '$lib/components/ImportWizard.svelte';
	import OnboardingWizard from '$lib/components/OnboardingWizard.svelte';
	import LoginGate from '$lib/components/LoginGate.svelte';
	import Ledger from '$lib/components/Ledger.svelte';
	import SnapshotsPanel from '$lib/components/SnapshotsPanel.svelte';
	import { settings, toggleTheme } from '$lib/settings.svelte';
	import { auth, initAuth, logout } from '$lib/auth.svelte';
	import { session, sendTurn, createCampaign, openCampaign, saveGame, checkConnection } from '$lib/session.svelte';
	import { apiAuthHeader } from '$lib/api';
	import { threadModel, statusFields } from '$lib/status';
	import type { CreationChoices } from '@rpg/engine';

	let showSettings = $state(false);
	let showCampaigns = $state(false);
	let showReference = $state(false);
	let showImport = $state(false);
	let showCreation = $state(false);
	let showOnboarding = $state(false);
	let showSnapshots = $state(false);
	let ledgerOpen = $state(true);

	const thread = $derived(session.state ? threadModel(session.state) : { intensity: 0.2, tone: 'accent' as const, pulse: false, label: '' });
	const topStatus = $derived(session.state ? statusFields(session.state) : []);

	onMount(() => {
		void (async () => {
			await initAuth();
			if (auth.authed) {
				await checkConnection();
				if (!settings.onboarded) showOnboarding = true;
			}
		})();
	});

	// После входа (в т.ч. первичной настройки) — поднять связь/онбординг.
	$effect(() => {
		if (auth.authed && !session.connected) {
			void (async () => {
				await checkConnection();
				if (!settings.onboarded) showOnboarding = true;
			})();
		}
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

	let cacheBusy = $state(false);

	// Полный сброс клиентского кэша: Service Worker + все Cache Storage → перезагрузка.
	async function resetCache() {
		cacheBusy = true;
		try {
			if ('serviceWorker' in navigator) {
				const regs = await navigator.serviceWorker.getRegistrations();
				await Promise.all(regs.map((r) => r.unregister()));
			}
			if ('caches' in window) {
				const keys = await caches.keys();
				await Promise.all(keys.map((k) => caches.delete(k)));
			}
		} catch {
			/* игнор — всё равно перезагружаем */
		}
		// жёсткая перезагрузка без кэша
		location.reload();
	}

	// Скачать все служебные логи: серверные (NDJSON ходов + снимок конфига) + клиентский контекст.
	async function downloadLogs() {
		const base = (settings.serverUrl || '').replace(/\/+$/, '');
		let server: unknown;
		try {
			const res = await fetch(`${base}/logs/export`, { headers: apiAuthHeader() });
			server = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
		} catch (e) {
			server = { error: (e as Error).message };
		}
		const bundle = {
			client: {
				at: new Date().toISOString(),
				url: location.href,
				userAgent: navigator.userAgent,
				settings: { serverUrl: settings.serverUrl, theme: settings.theme, textScale: settings.textScale, onboarded: settings.onboarded },
				session: { campaignId: session.campaignId, entries: session.entries.length, busy: session.busy, connected: session.connected }
			},
			server
		};
		const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `rpg-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

{#if auth.ready && !auth.authed}
	<LoginGate />
{:else if auth.authed}
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
	<div class="actions">
		<button class="icon" onclick={downloadLogs} aria-label="Скачать логи" title="Скачать служебные логи (сервер + клиент)">⬇</button>
		<button class="icon" onclick={resetCache} disabled={cacheBusy} aria-label="Сбросить кэш" title="Сбросить кэш (Service Worker + Cache Storage) и перезагрузить">♻</button>
		<button class="icon" onclick={() => (showSnapshots = true)} aria-label="Точки сохранения" title="Точки сохранения (откат)" disabled={!session.campaignId}>⤺</button>
		<button class="icon" onclick={() => (showCampaigns = true)} aria-label="Кампании" title="Кампании">📚</button>
		<button class="icon" onclick={() => (showReference = true)} aria-label="Справка по моделям" title="Справка: платные модели на роль Ведущего">💳</button>
		<button class="icon accent" onclick={toggleTheme} aria-label="Сменить тему" title={settings.theme === 'dark' ? 'Светлая тема (пергамент)' : 'Тёмная тема (тушь)'}>{settings.theme === 'dark' ? '☀' : '☾'}</button>
		<button class="icon" onclick={() => (showSettings = true)} aria-label="Настройки">⚙</button>
		<button class="icon" onclick={() => void logout()} aria-label="Выйти" title="Выйти">⎋</button>
	</div>
	</header>

	<main class="layout" class:ledger-open={ledgerOpen}>
		<section class="chronicle-col">
			<Chronicle entries={session.entries} />
			{#if session.dead}
				<div class="death" role="alert">
					<span class="death-title mono">☠ Герой пал</span>
					<span class="death-text">Смерть окончательна. Восстанови раннюю точку или начни заново.</span>
					<div class="death-actions">
						<button onclick={() => (showSnapshots = true)}>⤺ Восстановить точку</button>
						<button class="ghost" onclick={() => (showCreation = true)}>Новая игра</button>
					</div>
				</div>
			{:else}
				<Composer busy={session.busy} onsend={handleSend} />
			{/if}
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
					<button class="link" onclick={() => (showImport = true)}>⇪ Импорт из документов</button>
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
		onimport={() => { showCampaigns = false; showImport = true; }}
	/>
{/if}
{#if showImport}
	<ImportWizard
		oncancel={() => (showImport = false)}
		onimported={() => { showImport = false; addSystem('⇪ Партия импортирована. Продолжай ход.'); }}
	/>
{/if}
{#if showReference}<ReferencePanel onclose={() => (showReference = false)} />{/if}
{#if showSnapshots}<SnapshotsPanel onclose={() => (showSnapshots = false)} onrestored={() => addSystem('⤺ Состояние восстановлено из точки сохранения.')} />{/if}
{#if showCreation}<CreationWizard oncreated={onCreated} oncancel={() => (showCreation = false)} />{/if}
{#if showOnboarding}
	<OnboardingWizard
		onnew={() => { showOnboarding = false; showCreation = true; }}
		onload={() => { showOnboarding = false; showCampaigns = true; }}
		onclose={() => (showOnboarding = false)}
	/>
{/if}
{/if}

<style>
	.app { height: 100dvh; display: flex; flex-direction: column; }
	.topbar { display: flex; align-items: center; gap: .6rem; height: 54px; padding: 0 16px; border-bottom: 1px solid var(--rule); background: var(--surface); flex-shrink: 0; }
	.topbar .scene { flex: 1; display: flex; gap: .4rem; justify-content: center; flex-wrap: wrap; color: var(--text); font-size: .72rem; overflow: hidden; align-items: center; font-family: var(--font-mono); }
	.chip { white-space: nowrap; padding: .1rem .55rem; background: var(--chip-bg); border: 1px solid var(--chip-br); border-radius: 999px; }
	.sync { color: var(--danger); opacity: .7; }
	.sync.on { color: var(--accent); }
	.actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
	.icon { background: none; border: none; color: var(--text-dim); font-size: 1.05rem; padding: .2rem .4rem; line-height: 1; transition: color .15s; }
	.icon:hover { color: var(--accent); }
	.icon.accent { color: var(--accent); }
	.layout { flex: 1; display: grid; grid-template-columns: 1fr auto; min-height: 0; }
	.layout.ledger-open { grid-template-columns: 1fr auto minmax(240px, 320px); }
	.chronicle-col { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
	.death { margin: 0 auto; max-width: 70ch; width: 100%; padding: 1rem 1.2rem; border-top: 2px solid var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--surface)); display: flex; flex-direction: column; gap: .5rem; }
	.death-title { color: var(--danger); font-size: .95rem; letter-spacing: .06em; }
	.death-text { color: var(--text-dim); font-size: .85em; }
	.death-actions { display: flex; gap: .6rem; flex-wrap: wrap; }
	.death-actions button { background: var(--danger); color: #fff; border: none; border-radius: 6px; padding: .45rem .9rem; font-size: .85em; }
	.death-actions button.ghost { background: none; color: var(--text-dim); border: 1px solid var(--border); }
	.ledger { border-left: 1px solid var(--border); background: var(--surface); padding: 1.2rem; overflow-y: auto; }
	.empty-ledger { color: var(--text-dim); text-align: center; margin-top: 2rem; }
	.empty-ledger h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }
	.newgame { display: block; width: 100%; margin: 1rem 0 .6rem; background: var(--accent); color: var(--on-accent); border: none; border-radius: var(--radius); padding: .6rem 1.2rem; font-size: .95em; }
	.link { background: none; border: none; color: var(--link); text-decoration: underline; font-size: .85em; cursor: pointer; }
	.thread-legend { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: .3rem; font-size: .72em; color: var(--accent); }
	.thread-legend small { color: var(--text-dim); }
	@media (max-width: 760px) {
		.layout.ledger-open { grid-template-columns: 1fr auto; }
		.ledger { position: fixed; top: 0; right: 0; bottom: 0; width: min(85vw, 320px); z-index: 5; box-shadow: -8px 0 30px rgba(0,0,0,.4); }
	}
</style>
