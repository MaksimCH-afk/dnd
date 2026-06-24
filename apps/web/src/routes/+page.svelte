<script lang="ts">
	import { onMount } from 'svelte';
	import Chronicle from '$lib/components/Chronicle.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import StatusThread from '$lib/components/StatusThread.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import RulesPanel from '$lib/components/RulesPanel.svelte';
	import Ledger from '$lib/components/Ledger.svelte';
	import CreationWizard from '$lib/components/CreationWizard.svelte';
	import { chronicle, addEntry, clearChronicle } from '$lib/chronicle.svelte';
	import { settings } from '$lib/settings.svelte';
	import { game, loadGame, createCampaign, commitState, applyTurn, checkSeedsNow, directorPropose, importBundle, campaigns } from '$lib/game.svelte';
	import CampaignsPanel from '$lib/components/CampaignsPanel.svelte';
	import { isDarkScene } from '$lib/darkscene';
	import { buildSaveBundle } from '$lib/reports';
	import { commitAndPush, pull, readCanon } from '$lib/gitsync';
	import type { GameState } from '@rpg/engine';
	import { streamLlm } from '$lib/llm';
	import { buildNarratorMessages } from '$lib/prompt';
	import { extractOps } from '$lib/ops-extract';
	import { threadModel, statusFields } from '$lib/status';
	import { buildGoReport, buildSaveReport } from '$lib/reports';
	import { retrieve, indexItem } from '$lib/rag.svelte';

	let busy = $state(false);
	let showSettings = $state(false);
	let showRules = $state(false);
	let showCreation = $state(false);
	let showCampaigns = $state(false);
	let ledgerOpen = $state(true);
	let highlight = $state<Set<string>>(new Set());

	const thread = $derived(game.state ? threadModel(game.state) : { intensity: 0.2, tone: 'accent' as const, pulse: false, label: '' });
	const topStatus = $derived(game.state ? statusFields(game.state) : []);

	onMount(() => {
		void loadGame();
	});

	async function onCreated(state: GameState) {
		showCreation = false;
		await createCampaign(state.character.core.name, state);
		clearChronicle();
		const c = state.character.core;
		const mods = Object.keys(state.character.modules).join(', ') || 'без модулей';
		addEntry('system', `Создан персонаж: ${c.name}, ${c.race}, ${c.directions.join('/')} · модули: ${mods}.`);
		addEntry('master', state.session.current_moment + '\n\nЧто ты делаешь?');
	}

	async function handleSend(text: string) {
		if (text.startsWith('/save')) return doSave();
		if (text.startsWith('/ask')) return doAsk(text.replace(/^\/ask\s*/, ''));
		if (text.startsWith('/go')) return doGo();

		const playerText = text.replace(/^\/go\s*/, '').trim();
		if (!game.state) {
			addEntry('system', 'Сначала начните игру: кнопка «Новая игра» в гроссбухе.');
			return;
		}
		addEntry('player', playerText);

		// RAG-ретривал (если включён): top-k релевантного из памяти мира (№2).
		let retrieved: string[] = [];
		if (settings.ragEnabled) {
			try {
				const r = await retrieve(`${playerText} ${game.state.session.current_moment}`);
				retrieved = r.map((x) => x.text);
			} catch {
				/* эмбеддер недоступен — продолжаем без RAG */
			}
		}

		const factsBefore = game.state.facts.length;
		const npcBefore = game.state.npc.length;
		const messages = buildNarratorMessages(game.state, chronicle.entries, playerText, retrieved);
		const master = addEntry('master', '', true);
		// Тёмная сцена → упреждающий фоллбэк-профиль (не цензор).
		const preferFallback = isDarkScene(playerText, game.state.session.current_moment);
		busy = true;
		try {
			await streamLlm(settings.proxyUrl, 'narrator', messages, {
				onDelta: (chunk) => (master.text += chunk),
				onDone: (e) => {
					master.model = e.meta.model;
					master.usedFallback = e.meta.usedFallback;
				},
				onError: (e) => {
					master.text = master.text || `⚠ ${describeError(e.code)}: ${e.message}`;
				}
			}, { preferFallback });
			// Извлечь предложенные операции, применить через движок.
			const { clean, ops } = extractOps(master.text);
			master.text = clean;
			if (ops.length && game.state) {
				const before = new Map(game.state.inventory.items.map((i) => [i.id, i.qty]));
				const res = await applyTurn(ops);
				master.streaming = false;
				if (res) {
					highlight = changedItems(before);
					if (res.rejected.length) {
						addEntry('system', `Движок отклонил ${res.rejected.length} оп.: ${res.rejected.map((r) => r.reason).join('; ')}`);
					}
					// Индексируем новые факты/NPC в RAG (если включён).
					if (settings.ragEnabled && game.state) {
						for (const f of game.state.facts.slice(factsBefore)) {
							void indexItem({ id: f.id, kind: 'fact', text: f.text, day: f.created_day });
						}
						for (const n of game.state.npc.slice(npcBefore)) {
							void indexItem({ id: n.id, kind: 'npc', text: `${n.core.name}: ${n.core.role}, ${n.core.character}`, day: game.state.session.day });
						}
					}
				}
			}
		} catch (e) {
			if (!master.text) master.text = `⚠ Мир замер: нет связи с моделью. Ход не отправлен. (${(e as Error).message})`;
		} finally {
			master.streaming = false;
			busy = false;
		}

		// Проверка отложенных последствий (seeds) после хода (№1).
		const fired = await checkSeedsNow();
		for (const f of fired) addEntry('system', `⟳ Мир помнит: ${f}`);
	}

	async function runDirector() {
		if (!game.state) return;
		const hook = await directorPropose();
		if (hook) addEntry('system', `🎬 Режиссёр (мягкий хук, не приказ): ${hook}`);
	}

	function changedItems(before: Map<string, number>): Set<string> {
		const set = new Set<string>();
		if (!game.state) return set;
		for (const it of game.state.inventory.items) {
			if (before.get(it.id) !== it.qty) set.add(it.id);
		}
		return set;
	}

	async function doSave() {
		if (!game.state) {
			addEntry('system', 'Нечего сохранять — игра не начата.');
			return;
		}
		const report = buildSaveReport(game.state, game.lastApply);
		if (settings.gitEnabled && settings.gitRepoUrl) {
			addEntry('system', '⊙ Сохранение в git…');
			const r = await commitAndPush(game.state, `save: День ${game.state.session.day}`);
			addEntry('system', r.ok ? `${report}\n⊙ git: ${r.message}${r.commit ? ` (${r.commit})` : ''}` : `⚠ git: ${r.message}`);
		} else {
			const bundle = buildSaveBundle(game.state);
			downloadFile(`save-day${game.state.session.day}.json`, bundle['canon.json']!);
			addEntry('system', `${report}\nСейв выгружен файлом.`);
		}
	}

	function downloadFile(name: string, content: string) {
		const blob = new Blob([content], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function loadSaveFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const err = await importBundle(await file.text());
		input.value = '';
		if (err) {
			addEntry('system', `Не удалось загрузить сейв: ${err}`);
			return;
		}
		clearChronicle();
		addEntry('system', `Сейв загружен. День ${game.state!.session.day}.`);
		addEntry('master', game.state!.session.current_moment);
	}

	async function doGo() {
		// С git: подтянуть канон с удалённого (продолжить с любого устройства).
		if (settings.gitEnabled && settings.gitRepoUrl) {
			addEntry('system', '⊙ Загрузка из git…');
			const pr = await pull();
			if (!pr.ok) addEntry('system', `⚠ git pull: ${pr.message}`);
			const canon = await readCanon();
			if (canon) {
				commitState(canon);
				clearChronicle();
				addEntry('system', `⊙ Канон загружен из git. ${buildGoReport(canon)}`);
				addEntry('master', canon.session.current_moment);
				return;
			}
			addEntry('system', '⚠ В git нет канона — начните новую игру или сохраните текущую.');
		}
		if (!game.state) {
			addEntry('system', 'Игра не начата. Нажмите «Новая игра» в гроссбухе.');
			return;
		}
		addEntry('system', buildGoReport(game.state));
	}

	function doAsk(question: string) {
		if (!game.state) {
			addEntry('system', '/ask: игра не начата.');
			return;
		}
		const c = game.state.character.core;
		const lines = [`/ask${question ? ` — ${question}` : ''} (под капотом):`];
		lines.push(`Скрытые атрибуты: ${Object.entries(c.attrs).map(([k, v]) => `${k} ${v}`).join(', ')}`);
		if (game.lastApply) {
			lines.push(`Последний ход — лог движка:`);
			lines.push(...game.lastApply.log.map((l) => `  ${l}`));
			if (!game.lastApply.log.length) lines.push('  (операций не было)');
		} else {
			lines.push('Ходов с операциями ещё не было.');
		}
		addEntry('system', lines.join('\n'));
	}

	function describeError(code?: string): string {
		switch (code) {
			case 'no_key':
				return 'нет ключа OpenRouter (добавьте в настройках)';
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
		<button class="icon" onclick={() => (ledgerOpen = !ledgerOpen)} aria-label="Гроссбух">☰</button>
		<div class="scene mono">
			{#if topStatus.length}
				{#each topStatus.slice(0, 4) as f (f.label)}
					<span class="chip">{f.label} {f.value}</span>
				{/each}
			{:else}
				<span class="sync">⊙</span> Пролог
			{/if}
		</div>
		{#if game.state}
			<button class="icon" onclick={runDirector} aria-label="Режиссёр" title="Режиссёр: предложить новую арку">🎬</button>
		{/if}
		<button class="icon" onclick={() => (showCampaigns = true)} aria-label="Кампании" title="Кампании">📚</button>
		<button class="icon" onclick={() => (showRules = true)} aria-label="Файлы правил" title="Файлы правил">📖</button>
		<button class="icon" onclick={() => (showSettings = true)} aria-label="Настройки">⚙</button>
	</header>

	<main class="layout" class:ledger-open={ledgerOpen}>
		<section class="chronicle-col">
			<Chronicle entries={chronicle.entries} />
			<Composer {busy} onsend={handleSend} />
		</section>

		<StatusThread intensity={busy ? Math.min(1, thread.intensity + 0.2) : thread.intensity} tone={thread.tone} pulse={thread.pulse || busy} />

		<aside class="ledger" hidden={!ledgerOpen}>
			{#if game.state}
				<Ledger state={game.state} {highlight} />
				{#if thread.label}
					<div class="thread-legend mono">
						<span>нить состояния</span><small>{thread.label}</small>
					</div>
				{/if}
			{:else}
				<div class="empty-ledger">
					<h2 class="mono">Гроссбух</h2>
					<p>Игра не начата.</p>
					<button class="newgame" onclick={() => (showCreation = true)}>Новая игра</button>
					<label class="loadsave">
						Загрузить сейв
						<input type="file" accept=".json,application/json" onchange={loadSaveFile} hidden />
					</label>
					<small>Создание персонажа: раса, направление, скрытая проверка таланта.</small>
				</div>
			{/if}
		</aside>
	</main>
</div>

{#if showSettings}
	<SettingsPanel onclose={() => (showSettings = false)} />
{/if}
{#if showRules}
	<RulesPanel onclose={() => (showRules = false)} />
{/if}
{#if showCreation}
	<CreationWizard oncreated={onCreated} oncancel={() => (showCreation = false)} />
{/if}
{#if showCampaigns}
	<CampaignsPanel
		onclose={() => (showCampaigns = false)}
		onnew={() => { showCampaigns = false; showCreation = true; }}
		onswitched={() => { showCampaigns = false; clearChronicle(); if (game.state) addEntry('master', game.state.session.current_moment); }}
	/>
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
		display: flex;
		gap: 0.4rem;
		justify-content: center;
		flex-wrap: wrap;
		color: var(--text-dim);
		font-size: 0.78em;
		overflow: hidden;
	}
	.chip {
		white-space: nowrap;
		padding: 0.1rem 0.5rem;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.sync {
		color: var(--accent);
		opacity: 0.6;
	}
	.icon {
		background: none;
		border: none;
		color: var(--text-dim);
		font-size: 1.1rem;
		padding: 0.2rem 0.4rem;
	}
	.icon:hover {
		color: var(--accent);
	}

	.layout {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr auto;
		min-height: 0;
	}
	.layout.ledger-open {
		grid-template-columns: 1fr auto minmax(240px, 320px);
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
	.empty-ledger {
		color: var(--text-dim);
		text-align: center;
		margin-top: 2rem;
	}
	.empty-ledger h2 {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.newgame {
		margin: 1rem 0 0.6rem;
		background: var(--accent);
		color: var(--ink-900);
		border: none;
		border-radius: var(--radius);
		padding: 0.6rem 1.2rem;
		font-size: 0.95em;
	}
	.loadsave {
		display: inline-block;
		margin-bottom: 0.8rem;
		font-size: 0.85em;
		color: var(--link);
		cursor: pointer;
		text-decoration: underline;
	}
	.empty-ledger small {
		display: block;
		font-size: 0.75em;
		opacity: 0.7;
	}
	.thread-legend {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.72em;
		color: var(--accent);
	}
	.thread-legend small {
		color: var(--text-dim);
	}

	@media (max-width: 760px) {
		.layout.ledger-open {
			grid-template-columns: 1fr auto;
		}
		.ledger {
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			width: min(85vw, 320px);
			z-index: 5;
			box-shadow: -8px 0 30px rgba(0, 0, 0, 0.4);
		}
	}
</style>
