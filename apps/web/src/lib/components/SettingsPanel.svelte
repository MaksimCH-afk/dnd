<script lang="ts">
	import { settings, saveSettings } from '$lib/settings.svelte';
	import { api, type HealthInfo } from '$lib/api';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let health = $state<HealthInfo | null>(null);
	let healthError = $state('');
	let checking = $state(false);

	function commit() {
		saveSettings();
	}
	async function probe() {
		checking = true;
		healthError = '';
		health = null;
		try {
			health = await api.health(settings.serverUrl);
		} catch (e) {
			healthError = (e as Error).message;
		} finally {
			checking = false;
		}
	}
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Настройки" aria-modal="true">
	<header>
		<h2>Настройки</h2>
		<button class="close" onclick={onclose} aria-label="Закрыть">✕</button>
	</header>

	<label class="field">
		<span>Адрес сервера</span>
		<input class="mono" bind:value={settings.serverUrl} onchange={commit} placeholder="http://localhost:8787" />
	</label>

	<div class="field">
		<span>Связь с сервером</span>
		<div class="probe">
			<button onclick={probe} disabled={checking}>{checking ? 'Проверяю…' : 'Проверить'}</button>
			{#if health}
				<span class="ok mono">✓ v{health.version} · БД: {health.db ? 'ок' : 'нет'} · ключ: {health.hasKey ? 'есть' : 'нет'}</span>
			{:else if healthError}
				<span class="err mono">✕ {healthError}</span>
			{/if}
		</div>
		{#if health}
			<ul class="models mono">
				{#each Object.entries(health.models) as [role, m] (role)}<li><b>{role}</b>: {m.model}</li>{/each}
			</ul>
		{/if}
	</div>

	<label class="field row">
		<span>Тема</span>
		<select bind:value={settings.theme} onchange={commit}>
			<option value="light">Пергамент (светлая)</option>
			<option value="dark">Тушь (тёмная)</option>
		</select>
	</label>

	<label class="field row">
		<span>Размер текста</span>
		<input type="range" min="0.85" max="1.4" step="0.05" bind:value={settings.textScale} onchange={commit} oninput={commit} />
		<span class="mono val">{settings.textScale.toFixed(2)}×</span>
	</label>

	<p class="note">
		Ключи OpenRouter, выбор моделей, файлы правил и RAG — на сервере (в конфиге).
		Клиент тонкий: только интерфейс. Канон игры — в БД сервера.
	</p>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 10; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(92vw, 460px); max-height: 86vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem 1.4rem 1.4rem; z-index: 11; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
	header h2 { margin: 0; font-size: 1.2rem; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; }
	.field { display: flex; flex-direction: column; gap: .4rem; margin-bottom: 1rem; }
	.field > span { color: var(--text-dim); font-size: .85em; }
	.field.row { flex-direction: row; align-items: center; justify-content: space-between; }
	input, select { background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: .45rem .6rem; font: inherit; }
	input[type='range'] { flex: 1; margin: 0 .6rem; }
	.probe { display: flex; align-items: center; gap: .7rem; }
	.probe button { background: var(--surface-raised); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: .4rem .8rem; }
	.ok { color: var(--accent); font-size: .82em; }
	.err { color: var(--danger); font-size: .82em; }
	.models { list-style: none; padding: .6rem .8rem; margin: .6rem 0 0; background: var(--ink-900); border-radius: 6px; font-size: .72em; color: var(--text-dim); }
	.models li { margin-bottom: .2rem; overflow-wrap: anywhere; }
	.val { min-width: 3ch; color: var(--text-dim); }
	.note { font-size: .78em; color: var(--text-dim); border-top: 1px solid var(--border); padding-top: .8rem; margin-bottom: 0; }
</style>
