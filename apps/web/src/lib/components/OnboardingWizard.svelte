<script lang="ts">
	/** Первый запуск тонкого клиента: адрес сервера → старт. Ключи/модели — на сервере. */
	import { settings, saveSettings } from '$lib/settings.svelte';
	import { api, type HealthInfo } from '$lib/api';

	interface Props {
		onnew: () => void;
		onload: () => void;
		onclose: () => void;
	}
	let { onnew, onload, onclose }: Props = $props();

	let step = $state(0);
	let health = $state<HealthInfo | null>(null);
	let checking = $state(false);
	let error = $state('');

	async function check() {
		checking = true;
		error = '';
		health = null;
		saveSettings();
		try {
			health = await api.health(settings.serverUrl);
			if (health.ok) step = 1;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			checking = false;
		}
	}
	function finish(action: 'new' | 'load') {
		settings.onboarded = true;
		saveSettings();
		action === 'new' ? onnew() : onload();
	}
</script>

<div class="backdrop"></div>
<div class="panel" role="dialog" aria-label="Первый запуск" aria-modal="true">
	<header>
		<h2>Добро пожаловать</h2>
		<button class="skip" onclick={() => { settings.onboarded = true; saveSettings(); onclose(); }}>Пропустить</button>
	</header>

	{#if step === 0}
		<p>Укажите адрес игрового сервера. Ключи OpenRouter и модели настроены на сервере — в клиент вводить ничего не нужно.</p>
		<input class="mono" bind:value={settings.serverUrl} placeholder="http://localhost:8787" />
		<div class="row">
			<button class="primary" onclick={check} disabled={checking}>{checking ? 'Проверяю…' : 'Подключиться'}</button>
			{#if error}<span class="err mono">✕ {error}</span>{/if}
		</div>
		<small>Для игры с планшета укажите адрес компьютера/сервера в сети (или Tailscale-адрес).</small>
	{:else}
		<p>Сервер на связи{health ? ` (v${health.version}, БД: ${health.db ? 'ок' : 'нет'}, ключ: ${health.hasKey ? 'есть' : 'нет'})` : ''}. Начните новую игру или откройте сохранённую.</p>
		{#if health && !health.hasKey}<p class="warn">⚠ На сервере не задан ключ OpenRouter — ходы не будут работать. Добавьте ключ в конфиге сервера.</p>{/if}
		<div class="finish">
			<button class="primary" onclick={() => finish('new')}>Новая игра</button>
			<button onclick={() => finish('load')}>Открыть кампанию</button>
		</div>
	{/if}
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 12; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(94vw, 460px); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem 1.4rem 1.4rem; z-index: 13; box-shadow: 0 24px 70px rgba(0,0,0,.6); }
	header { display: flex; justify-content: space-between; align-items: center; }
	header h2 { margin: 0; font-size: 1.3rem; }
	.skip { background: none; border: none; color: var(--text-dim); font-size: .8em; text-decoration: underline; }
	p { font-size: .9em; color: var(--text-dim); }
	.warn { color: var(--danger); }
	input { width: 100%; background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: .5rem .6rem; font: inherit; margin-bottom: .6rem; }
	.row { display: flex; gap: .6rem; align-items: center; }
	.row button, .finish button { background: var(--surface-raised); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: .5rem 1rem; font-size: .9em; }
	.primary { background: var(--accent) !important; color: var(--on-accent) !important; border: none !important; }
	.finish { display: flex; gap: .6rem; }
	.err { color: var(--danger); font-size: .85em; }
	small { color: var(--text-dim); font-size: .76em; }
</style>
