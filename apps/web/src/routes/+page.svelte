<script lang="ts">
	import Chronicle from '$lib/components/Chronicle.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import StatusThread from '$lib/components/StatusThread.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import RulesPanel from '$lib/components/RulesPanel.svelte';
	import { chronicle, addEntry } from '$lib/chronicle.svelte';
	import { settings } from '$lib/settings.svelte';
	import { streamLlm } from '$lib/llm';
	import { buildNarratorMessages } from '$lib/prompt';

	let busy = $state(false);
	let showSettings = $state(false);
	let showRules = $state(false);
	let ledgerOpen = $state(true);

	async function handleSend(text: string) {
		// Команды фазы 0: /save и /ask ещё не подкреплены состоянием — честно сообщаем.
		if (text.startsWith('/save')) {
			addEntry('system', 'Сохранение появится в Фазе 1 (движок состояния + git-синк). Сейчас хроника эфемерна.');
			return;
		}
		if (text.startsWith('/ask')) {
			addEntry('system', 'Мета-режим «/ask» (взгляд под капот: броски, Сила, причины реакций) появится в Фазе 4 вместе с механикой.');
			return;
		}
		// /go в фазе 0 = просто продолжить; команду из текста убираем.
		const playerText = text.replace(/^\/go\s*/, '').trim() || 'Продолжаем.';

		addEntry('player', playerText);
		const messages = buildNarratorMessages(chronicle.entries, playerText);

		const master = addEntry('master', '', true);
		busy = true;
		try {
			await streamLlm(settings.proxyUrl, 'narrator', messages, {
				onDelta: (chunk) => {
					master.text += chunk;
				},
				onDone: (e) => {
					master.streaming = false;
					master.model = e.meta.model;
					master.usedFallback = e.meta.usedFallback;
				},
				onError: (e) => {
					master.streaming = false;
					master.text = master.text || `⚠ ${describeError(e.code)}: ${e.message}`;
				}
			});
		} catch (e) {
			master.streaming = false;
			if (!master.text) {
				master.text = `⚠ Мир замер: нет связи с моделью. Ход не отправлен — попробуйте снова. (${(e as Error).message})`;
			}
		} finally {
			master.streaming = false;
			busy = false;
		}
	}

	function describeError(code?: string): string {
		switch (code) {
			case 'no_key':
				return 'на прокси не задан ключ OpenRouter';
			case 'upstream':
				return 'модель недоступна (исчерпаны ретраи и фоллбэк)';
			default:
				return 'ошибка генерации';
		}
	}
</script>

<svelte:head>
	<title>Текстовое НРИ</title>
</svelte:head>

<div class="app">
	<header class="topbar">
		<button class="ledger-toggle" onclick={() => (ledgerOpen = !ledgerOpen)} aria-label="Гроссбух">☰</button>
		<div class="scene mono">
			<span class="sync" title="Синхронизация — Фаза 1">⊙</span>
			Пролог · хроника
		</div>
		<button class="settings-btn" onclick={() => (showRules = true)} aria-label="Файлы правил" title="Файлы правил">📖</button>
		<button class="settings-btn" onclick={() => (showSettings = true)} aria-label="Настройки">⚙</button>
	</header>

	<main class="layout" class:ledger-open={ledgerOpen}>
		<section class="chronicle-col">
			<Chronicle entries={chronicle.entries} />
			<Composer {busy} onsend={handleSend} />
		</section>

		<StatusThread intensity={busy ? 0.5 : 0.2} pulse={busy} />

		<aside class="ledger" hidden={!ledgerOpen}>
			<h2 class="mono">Гроссбух</h2>
			<p class="ph">
				Состояние персонажа, инвентарь, NPC и таймеры появятся здесь в Фазе 1–4.
				Гроссбух рендерит только активные модули сборки.
			</p>
			<div class="thread-legend mono">
				<span>нить состояния</span>
				<small>кодирует ресурс-риск сборки (Сила / выносливость / след / вера)</small>
			</div>
		</aside>
	</main>
</div>

{#if showSettings}
	<SettingsPanel onclose={() => (showSettings = false)} />
{/if}

{#if showRules}
	<RulesPanel onclose={() => (showRules = false)} />
{/if}

<style>
	.app {
		height: 100dvh;
		display: flex;
		flex-direction: column;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem var(--gutter);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		flex-shrink: 0;
	}
	.topbar .scene {
		flex: 1;
		text-align: center;
		color: var(--text-dim);
		font-size: 0.85em;
	}
	.sync {
		color: var(--accent);
		opacity: 0.6;
		margin-right: 0.3rem;
	}
	.ledger-toggle,
	.settings-btn {
		background: none;
		border: none;
		color: var(--text-dim);
		font-size: 1.1rem;
		padding: 0.2rem 0.4rem;
	}
	.ledger-toggle:hover,
	.settings-btn:hover {
		color: var(--accent);
	}

	.layout {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr auto;
		min-height: 0;
	}
	.layout.ledger-open {
		grid-template-columns: 1fr auto minmax(220px, 300px);
	}

	.chronicle-col {
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
	}

	.ledger {
		border-left: 1px solid var(--border);
		background: var(--surface);
		padding: 1.2rem;
		overflow-y: auto;
	}
	.ledger h2 {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		margin: 0 0 1rem;
	}
	.ledger .ph {
		font-size: 0.85em;
		color: var(--text-dim);
		line-height: 1.5;
	}
	.thread-legend {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.75em;
		color: var(--accent);
	}
	.thread-legend small {
		color: var(--text-dim);
	}

	/* Планшет/телефон: гроссбух — шторка (упрощённо в фазе 0 — скрыт). */
	@media (max-width: 760px) {
		.layout.ledger-open {
			grid-template-columns: 1fr auto;
		}
		.ledger {
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			width: min(80vw, 300px);
			z-index: 5;
			box-shadow: -8px 0 30px rgba(0, 0, 0, 0.4);
		}
	}
</style>
