<script lang="ts">
	/**
	 * Единый мастер первого запуска (ТЗ §18.5, пункт C): ключ → синк → модели →
	 * Новая игра/Загрузить. Все поля переиспользуют те же сторы, что и настройки.
	 */
	import { settings, saveSettings } from '$lib/settings.svelte';
	import { keys, setKey } from '$lib/keys.svelte';
	import { checkHealth, verifyKey } from '$lib/llm';
	import { ensureRepo } from '$lib/gitsync';
	import type { HealthResponse } from '@rpg/engine';

	interface Props {
		onnew: () => void;
		onload: () => void;
		onclose: () => void;
	}
	let { onnew, onload, onclose }: Props = $props();

	let step = $state(0);
	const steps = ['Ключ', 'Синхронизация', 'Модели', 'Старт'];

	// Шаг 1 — ключ
	let keyDraft = $state(keys.openrouter);
	let keyStatus = $state<{ ok: boolean; text: string } | null>(null);
	let verifying = $state(false);
	async function verifyAndSave() {
		setKey(keyDraft, 'openrouter');
		verifying = true;
		keyStatus = null;
		try {
			const r = await verifyKey(settings.proxyUrl, keyDraft.trim());
			keyStatus = r.ok ? { ok: true, text: `действителен${r.modelCount ? ` · ${r.modelCount} моделей` : ''}` } : { ok: false, text: r.error ?? 'отклонён' };
		} catch (e) {
			keyStatus = { ok: false, text: (e as Error).message };
		} finally {
			verifying = false;
		}
	}

	// Шаг 2 — синк
	let gitToken = $state(keys.git);
	let gitStatus = $state<{ ok: boolean; text: string } | null>(null);
	let gitBusy = $state(false);
	async function testGit() {
		setKey(gitToken, 'git');
		saveSettings();
		gitBusy = true;
		try {
			const r = await ensureRepo();
			gitStatus = { ok: r.ok, text: r.message };
		} finally {
			gitBusy = false;
		}
	}

	// Шаг 3 — модели
	let health = $state<HealthResponse | null>(null);
	async function loadModels() {
		try {
			health = await checkHealth(settings.proxyUrl);
		} catch {
			health = null;
		}
	}

	function next() {
		if (step === 1) saveSettings();
		if (step === 2 && !health) void loadModels();
		step = Math.min(steps.length - 1, step + 1);
		if (step === 2) void loadModels();
	}
	function back() {
		step = Math.max(0, step - 1);
	}
	function finish(action: 'new' | 'load') {
		settings.onboarded = true;
		saveSettings();
		if (action === 'new') onnew();
		else onload();
	}
</script>

<div class="backdrop"></div>
<div class="panel" role="dialog" aria-label="Первый запуск" aria-modal="true">
	<header>
		<h2>Добро пожаловать</h2>
		<button class="skip" onclick={() => { settings.onboarded = true; saveSettings(); onclose(); }}>Пропустить</button>
	</header>

	<ol class="stepper mono">
		{#each steps as s, i (s)}
			<li class:active={i === step} class:done={i < step}>{i + 1}. {s}</li>
		{/each}
	</ol>

	<div class="body">
		{#if step === 0}
			<p>Ключ OpenRouter — для вызовов модели-рассказчика. Хранится в этом браузере, шлётся прокси.</p>
			<input class="mono" type="password" bind:value={keyDraft} placeholder="sk-or-v1-…" autocomplete="off" />
			<div class="row">
				<button onclick={verifyAndSave} disabled={verifying || !keyDraft.trim()}>{verifying ? 'Проверяю…' : 'Сохранить и проверить'}</button>
				{#if keyStatus}<span class="mono" class:ok={keyStatus.ok} class:err={!keyStatus.ok}>{keyStatus.ok ? '✓' : '✕'} {keyStatus.text}</span>{/if}
			</div>
			<small>Можно пропустить и добавить позже в настройках.</small>
		{:else if step === 1}
			<p>Синхронизация канона через git (необязательно) — игра на нескольких устройствах.</p>
			<label class="check"><input type="checkbox" bind:checked={settings.gitEnabled} /> <span>Включить git-синхронизацию</span></label>
			{#if settings.gitEnabled}
				<input class="mono" bind:value={settings.gitRepoUrl} placeholder="https://github.com/user/repo.git" />
				<div class="row">
					<input class="mono" bind:value={settings.gitBranch} placeholder="main" style="max-width:8rem" />
					<input class="mono" type="password" bind:value={gitToken} placeholder="git-токен" autocomplete="off" />
				</div>
				<div class="row">
					<button onclick={testGit} disabled={gitBusy || !settings.gitRepoUrl}>{gitBusy ? '…' : 'Проверить'}</button>
					{#if gitStatus}<span class="mono" class:ok={gitStatus.ok} class:err={!gitStatus.ok}>{gitStatus.ok ? '✓' : '✕'} {gitStatus.text}</span>{/if}
				</div>
			{/if}
		{:else if step === 2}
			<p>Модели по ролям. По умолчанию — рабочая раскладка free-моделей (можно сменить в настройках).</p>
			{#if health}
				<ul class="models mono">
					{#each Object.entries(health.models) as [role, m] (role)}<li><b>{role}</b>: {m.model}</li>{/each}
				</ul>
			{:else}
				<button onclick={loadModels}>Загрузить раскладку с прокси</button>
			{/if}
		{:else}
			<p>Готово. Начните новую игру (создание персонажа) или загрузите сохранение.</p>
			<div class="finish">
				<button class="primary" onclick={() => finish('new')}>Новая игра</button>
				<button onclick={() => finish('load')}>Загрузить</button>
			</div>
		{/if}
	</div>

	<footer>
		<button onclick={back} disabled={step === 0}>Назад</button>
		{#if step < steps.length - 1}<button class="primary" onclick={next}>Далее</button>{/if}
	</footer>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 12; }
	.panel {
		position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
		width: min(94vw, 480px); max-height: 88vh; overflow-y: auto; background: var(--surface);
		border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem 1.4rem 1.4rem; z-index: 13;
		box-shadow: 0 24px 70px rgba(0,0,0,.6);
	}
	header { display: flex; justify-content: space-between; align-items: center; }
	header h2 { margin: 0; font-size: 1.3rem; }
	.skip { background: none; border: none; color: var(--text-dim); font-size: .8em; text-decoration: underline; }
	.stepper { list-style: none; display: flex; gap: .5rem; padding: 0; margin: .8rem 0 1rem; font-size: .72em; flex-wrap: wrap; }
	.stepper li { color: var(--text-dim); }
	.stepper li.active { color: var(--accent); }
	.stepper li.done { color: var(--vellum-300); }
	.body { min-height: 9rem; }
	.body p { font-size: .9em; color: var(--text-dim); margin-top: 0; }
	input { width: 100%; background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: .5rem .6rem; font: inherit; margin-bottom: .5rem; }
	.row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-bottom: .5rem; }
	.row button, footer button, .finish button { background: var(--surface-raised); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: .45rem .9rem; font-size: .88em; }
	.primary { background: var(--accent) !important; color: var(--ink-900) !important; border: none !important; }
	.ok { color: var(--accent); font-size: .85em; }
	.err { color: var(--danger); font-size: .85em; }
	.check { display: flex; gap: .5rem; align-items: center; font-size: .9em; margin-bottom: .6rem; }
	.check input { width: auto; margin: 0; }
	.models { list-style: none; padding: .6rem .8rem; margin: 0; background: var(--ink-900); border-radius: 6px; font-size: .72em; color: var(--text-dim); }
	.models li { margin-bottom: .2rem; overflow-wrap: anywhere; }
	.finish { display: flex; gap: .6rem; }
	small { color: var(--text-dim); font-size: .76em; }
	footer { display: flex; justify-content: space-between; margin-top: 1.2rem; }
	footer button:disabled { opacity: .4; }
</style>
