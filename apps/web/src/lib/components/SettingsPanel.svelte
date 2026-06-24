<script lang="ts">
	import { settings, saveSettings } from '$lib/settings.svelte';
	import { keys, setKey, clearKey } from '$lib/keys.svelte';
	import { checkHealth, verifyKey } from '$lib/llm';
	import { ragStatus, ensureEmbedder } from '$lib/rag.svelte';
	import { ensureRepo } from '$lib/gitsync';
	import { logState, bugBundle, clearLogs } from '$lib/logbus.svelte';
	import { game } from '$lib/game.svelte';
	import type { HealthResponse } from '@rpg/engine';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let health = $state<HealthResponse | null>(null);
	let healthError = $state('');
	let checking = $state(false);

	// --- Управление ключом OpenRouter ---
	let keyDraft = $state(keys.openrouter);
	let showKey = $state(false);
	let keyDirty = $derived(keyDraft.trim() !== keys.openrouter);
	let verifying = $state(false);
	let keyStatus = $state<{ ok: boolean; text: string } | null>(null);

	function saveKey() {
		setKey(keyDraft);
		keyStatus = { ok: true, text: 'Сохранён' };
	}
	function deleteKey() {
		clearKey();
		keyDraft = '';
		keyStatus = null;
	}
	async function checkKey() {
		verifying = true;
		keyStatus = null;
		try {
			const r = await verifyKey(settings.proxyUrl, keyDraft.trim());
			keyStatus = r.ok
				? { ok: true, text: `Действителен${r.modelCount ? ` · ${r.modelCount} моделей` : ''}` }
				: { ok: false, text: r.error ?? 'отклонён' };
		} catch (e) {
			keyStatus = { ok: false, text: (e as Error).message };
		} finally {
			verifying = false;
		}
	}

	async function probe() {
		checking = true;
		healthError = '';
		health = null;
		try {
			health = await checkHealth(settings.proxyUrl);
		} catch (e) {
			healthError = (e as Error).message;
		} finally {
			checking = false;
		}
	}

	function commit() {
		saveSettings();
	}

	// --- Git-синхронизация ---
	let gitToken = $state(keys.git);
	let gitStatus = $state<{ ok: boolean; text: string } | null>(null);
	let gitBusy = $state(false);
	function saveGitToken() {
		setKey(gitToken, 'git');
		gitStatus = { ok: true, text: 'токен сохранён' };
	}
	function exportBugBundle() {
		const content = bugBundle(game.state ? $state.snapshot(game.state) : null);
		const blob = new Blob([content], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `bug-bundle-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function testGit() {
		gitBusy = true;
		gitStatus = null;
		setKey(gitToken, 'git');
		saveSettings();
		try {
			const r = await ensureRepo();
			gitStatus = { ok: r.ok, text: r.message };
		} catch (e) {
			gitStatus = { ok: false, text: (e as Error).message };
		} finally {
			gitBusy = false;
		}
	}
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Настройки" aria-modal="true">
	<header>
		<h2>Настройки</h2>
		<button class="close" onclick={onclose} aria-label="Закрыть">✕</button>
	</header>

	<div class="field">
		<span>Ключ OpenRouter</span>
		<div class="keyrow">
			<input
				class="mono"
				type={showKey ? 'text' : 'password'}
				bind:value={keyDraft}
				placeholder="sk-or-v1-…"
				autocomplete="off"
				spellcheck="false"
			/>
			<button class="ghost" onclick={() => (showKey = !showKey)} aria-label="Показать/скрыть">
				{showKey ? '🙈' : '👁'}
			</button>
		</div>
		<div class="keyactions">
			<button onclick={saveKey} disabled={!keyDirty || !keyDraft.trim()}>Сохранить</button>
			<button onclick={checkKey} disabled={verifying || !keyDraft.trim()}>
				{verifying ? 'Проверяю…' : 'Проверить'}
			</button>
			<button class="danger" onclick={deleteKey} disabled={!keys.openrouter && !keyDraft}>Удалить</button>
		</div>
		{#if keyStatus}
			<span class="mono" class:ok={keyStatus.ok} class:err={!keyStatus.ok}>
				{keyStatus.ok ? '✓' : '✕'} {keyStatus.text}
			</span>
		{/if}
		<small class="hint">
			Ключ хранится в этом браузере (localStorage) и отправляется прокси при каждом ходе.
			Прокси сам ключи не хранит.
		</small>
	</div>

	<label class="field">
		<span>Адрес прокси</span>
		<input class="mono" bind:value={settings.proxyUrl} onchange={commit} placeholder="http://localhost:8787" />
	</label>

	<div class="field">
		<span>Связь с прокси</span>
		<div class="probe">
			<button onclick={probe} disabled={checking}>{checking ? 'Проверяю…' : 'Проверить'}</button>
			{#if health}
				<span class="ok mono">✓ v{health.version}{health.hasEnvKey ? ' · env-сид' : ''}</span>
			{:else if healthError}
				<span class="err mono">✕ {healthError}</span>
			{/if}
		</div>
		{#if health}
			<ul class="models mono">
				{#each Object.entries(health.models) as [role, m] (role)}
					<li><b>{role}</b>: {m.model}</li>
				{/each}
			</ul>
		{/if}
	</div>

	<label class="field row">
		<span>Тема</span>
		<select bind:value={settings.theme} onchange={commit}>
			<option value="dark">Тёмная (тушь)</option>
			<option value="light">Светлая (скрипторий)</option>
		</select>
	</label>

	<label class="field row">
		<span>Размер текста</span>
		<input
			type="range"
			min="0.85"
			max="1.4"
			step="0.05"
			bind:value={settings.textScale}
			onchange={commit}
			oninput={commit}
		/>
		<span class="mono val">{settings.textScale.toFixed(2)}×</span>
	</label>

	<div class="field">
		<label class="check">
			<input type="checkbox" bind:checked={settings.ragEnabled} onchange={commit} />
			<span>Локальный поиск по памяти (RAG)</span>
		</label>
		<small class="hint">
			Улучшает память мира (баг №2): подтягивает релевантные факты/NPC. Грузит
			модель-эмбеддер ({settings.embedderModel}) в браузер (~сотни МБ, первый раз долго).
		</small>
		{#if settings.ragEnabled}
			<div class="probe">
				<button onclick={() => ensureEmbedder(settings.embedderModel)} disabled={ragStatus.loading || ragStatus.ready}>
					{ragStatus.ready ? 'Модель готова' : ragStatus.loading ? 'Загрузка…' : 'Загрузить модель'}
				</button>
				{#if ragStatus.loading && ragStatus.progress != null}
					<span class="mono">{Math.round(ragStatus.progress)}%</span>
				{/if}
				{#if ragStatus.ready}<span class="ok mono">✓</span>{/if}
				{#if ragStatus.error}<span class="err mono">✕ {ragStatus.error}</span>{/if}
			</div>
		{/if}
	</div>

	<div class="field">
		<label class="check">
			<input type="checkbox" bind:checked={settings.validatorEnabled} onchange={commit} />
			<span>LLM-валидатор утечек знания</span>
		</label>
		<small class="hint">
			Доп. вызов модели на ход: семантически проверяет, не сослался ли NPC на знание
			вне своей памяти (страховка к детерминированному scope, баг №3). +латентность.
		</small>
	</div>

	<div class="field">
		<label class="check">
			<input type="checkbox" bind:checked={settings.gitEnabled} onchange={commit} />
			<span>Синхронизация канона через git (кросс-девайс)</span>
		</label>
		{#if settings.gitEnabled}
			<input class="mono giturl" bind:value={settings.gitRepoUrl} onchange={commit} placeholder="https://github.com/user/repo.git" />
			<div class="keyrow">
				<input class="mono" bind:value={settings.gitBranch} onchange={commit} placeholder="ветка (main)" />
				<input class="mono" type="password" bind:value={gitToken} placeholder="git-токен (PAT)" autocomplete="off" />
			</div>
			<div class="keyactions">
				<button onclick={saveGitToken} disabled={!gitToken.trim()}>Сохранить токен</button>
				<button onclick={testGit} disabled={gitBusy || !settings.gitRepoUrl}>
					{gitBusy ? 'Проверяю…' : 'Проверить / клонировать'}
				</button>
			</div>
			{#if gitStatus}
				<span class="mono" class:ok={gitStatus.ok} class:err={!gitStatus.ok}>{gitStatus.ok ? '✓' : '✕'} {gitStatus.text}</span>
			{/if}
			<small class="hint">
				`/save` коммитит и пушит канон, `/go` подтягивает. Канон — в этом репо;
				файлы правил не затрагиваются. Токен хранится в браузере.
			</small>
		{/if}
	</div>

	<div class="field row">
		<span>Логи (раздел 22)</span>
		<select bind:value={settings.logLevel} onchange={commit}>
			<option value="info">info</option>
			<option value="debug">debug</option>
			<option value="trace">trace</option>
			<option value="warn">warn</option>
			<option value="error">error</option>
		</select>
	</div>
	<div class="keyactions">
		<button onclick={exportBugBundle}>Экспорт bug-bundle</button>
		<button onclick={clearLogs}>Очистить логи</button>
		<span class="mono val">{logState.count} соб.</span>
	</div>
	<small class="hint">
		NDJSON-лог хода (ввод/контекст/механика/вызовы моделей/дельты/синк) пишется
		движком локально. debug/trace добавляют полные промпты — тяжелее. Логи вне git.
	</small>

	<p class="note">
		Прокси stateless: хранит и проксирует только LLM-вызовы, без игрового состояния.
		Канон игры — в git-репозитории (синхронизация — Фаза 1).
	</p>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 10;
	}
	.panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(92vw, 460px);
		max-height: 86vh;
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.2rem 1.4rem 1.4rem;
		z-index: 11;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	header h2 {
		margin: 0;
		font-size: 1.2rem;
	}
	.close {
		background: none;
		border: none;
		color: var(--text-dim);
		font-size: 1.1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-bottom: 1rem;
	}
	.field > span {
		color: var(--text-dim);
		font-size: 0.85em;
	}
	.field.row {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}
	input,
	select {
		background: var(--surface-raised);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.45rem 0.6rem;
		font: inherit;
	}
	input[type='range'] {
		flex: 1;
		margin: 0 0.6rem;
	}
	.probe {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.probe button {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 6px;
		padding: 0.4rem 0.8rem;
	}
	.ok {
		color: var(--accent);
		font-size: 0.85em;
	}
	.err {
		color: var(--danger);
		font-size: 0.85em;
	}
	.keyrow {
		display: flex;
		gap: 0.4rem;
	}
	.keyrow input {
		flex: 1;
		min-width: 0;
	}
	.giturl {
		width: 100%;
		margin-bottom: 0.5rem;
	}
	.ghost {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0 0.6rem;
	}
	.keyactions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}
	.keyactions button {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 6px;
		padding: 0.35rem 0.7rem;
		font-size: 0.85em;
	}
	.keyactions button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.keyactions .danger {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}
	.hint {
		display: block;
		margin-top: 0.5rem;
		font-size: 0.75em;
		color: var(--text-dim);
		line-height: 1.4;
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		cursor: pointer;
	}
	.check span {
		font-size: 0.9em;
	}
	.models {
		list-style: none;
		padding: 0.6rem 0.8rem;
		margin: 0.6rem 0 0;
		background: var(--ink-900);
		border-radius: 6px;
		font-size: 0.72em;
		color: var(--text-dim);
	}
	.models li {
		margin-bottom: 0.2rem;
		overflow-wrap: anywhere;
	}
	.val {
		min-width: 3ch;
		color: var(--text-dim);
	}
	.note {
		font-size: 0.78em;
		color: var(--text-dim);
		border-top: 1px solid var(--border);
		padding-top: 0.8rem;
		margin-bottom: 0;
	}
</style>
