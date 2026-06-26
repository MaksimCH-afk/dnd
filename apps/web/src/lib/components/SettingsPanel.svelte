<script lang="ts">
	import { settings, saveSettings } from '$lib/settings.svelte';
	import { api, adminApi, type HealthInfo, type AdminConfigView, type AdminConfigPatch } from '$lib/api';

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

	// --- Администрирование (ключи/модели по ролям; без пароля — приватный доступ) ---
	let adminOpen = $state(false);
	let adminView = $state<AdminConfigView | null>(null);
	let adminErr = $state('');
	let adminMsg = $state('');
	let adminBusy = $state(false);

	// поля моделей (предзаполняются текущими), поля ключей (всегда пустые — секреты не показываем)
	let mNarrator = $state('');
	let mValidator = $state('');
	let mDirector = $state('');
	let mFallback = $state('');
	let mNpc = $state('');
	let kDefault = $state('');
	let kNarrator = $state('');
	let kValidator = $state('');
	let kDirector = $state('');
	let kFallback = $state('');
	let kNpc = $state('');

	function fillModels(v: AdminConfigView) {
		mNarrator = v.models.narrator.join('\n');
		mValidator = v.models.validator.join('\n');
		mDirector = v.models.director.join('\n');
		mFallback = v.models.fallback.join('\n');
		mNpc = v.models.npc.join('\n');
	}
	const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

	async function adminToggle() {
		adminOpen = !adminOpen;
		if (adminOpen && !adminView) await adminLoad();
	}

	async function adminLoad() {
		adminErr = '';
		adminMsg = '';
		adminBusy = true;
		try {
			adminView = await adminApi.get(settings.serverUrl);
			fillModels(adminView);
		} catch (e) {
			adminErr = (e as Error).message;
		} finally {
			adminBusy = false;
		}
	}

	async function adminSave() {
		adminErr = '';
		adminMsg = '';
		adminBusy = true;
		const patch: AdminConfigPatch = {
			models: { narrator: lines(mNarrator), validator: lines(mValidator), director: lines(mDirector), fallback: lines(mFallback), npc: lines(mNpc) },
			keys: {}
		};
		if (kDefault.trim()) patch.keys!.default = kDefault.trim();
		if (kNarrator.trim()) patch.keys!.narrator = kNarrator.trim();
		if (kValidator.trim()) patch.keys!.validator = kValidator.trim();
		if (kDirector.trim()) patch.keys!.director = kDirector.trim();
		if (kFallback.trim()) patch.keys!.fallback = kFallback.trim();
		if (kNpc.trim()) patch.keys!.npc = kNpc.trim();
		try {
			adminView = await adminApi.save(settings.serverUrl, patch);
			fillModels(adminView);
			kDefault = kNarrator = kValidator = kDirector = kFallback = kNpc = '';
			adminMsg = 'Сохранено и применено.';
		} catch (e) {
			adminErr = (e as Error).message;
		} finally {
			adminBusy = false;
		}
	}

	async function clearKey(role: 'default' | 'narrator' | 'validator' | 'director' | 'fallback' | 'npc') {
		adminBusy = true;
		adminErr = '';
		adminMsg = '';
		try {
			adminView = await adminApi.save(settings.serverUrl, { keys: { [role]: '' } });
			adminMsg = `Ключ роли «${role}» сброшен к серверному.`;
		} catch (e) {
			adminErr = (e as Error).message;
		} finally {
			adminBusy = false;
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
		<input class="mono" bind:value={settings.serverUrl} onchange={commit} placeholder="пусто = этот сервер" />
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

	<!-- Администрирование: ключи и модели по ролям (на сервере, в БД) -->
	<div class="admin">
		<button class="admin-toggle" onclick={adminToggle}>
			<span>{adminOpen ? '▾' : '▸'} Администрирование — ключи и модели</span>
		</button>
		{#if adminOpen}
			{#if !adminView}
				<p class="hint">{adminBusy ? 'Загрузка с сервера…' : 'Не удалось загрузить настройки.'}</p>
				{#if adminErr}<span class="err mono">✕ {adminErr}</span> <button class="retry" onclick={adminLoad}>Повторить</button>{/if}
			{:else}
				<div class="admin-block">
					<div class="block-title mono">Модели по ролям</div>
					<p class="hint">По одному id OpenRouter в строке: <b>первая — основная</b>, далее альтернативы по порядку (авто-фолбэк при отказе/лимите). Пусто — вернуть к дефолту.</p>
					{#snippet modelBox(label: string, role: 'narrator' | 'validator' | 'director' | 'fallback' | 'npc', value: string, set: (v: string) => void)}
						<div class="model-block">
							<div class="model-head">
								<span class="ml mono">{label}</span>
								<button class="reset" title="Подставить дефолтный список" onclick={() => set(adminView!.defaults[role].join('\n'))}>↺ дефолт</button>
							</div>
							<textarea
								class="mono"
								rows={Math.max(2, value.split('\n').length)}
								placeholder="vendor/model-id"
								value={value}
								oninput={(e) => set((e.currentTarget as HTMLTextAreaElement).value)}
							></textarea>
						</div>
					{/snippet}
					{@render modelBox('Ведущий', 'narrator', mNarrator, (v) => (mNarrator = v))}
					{@render modelBox('Валидатор', 'validator', mValidator, (v) => (mValidator = v))}
					{@render modelBox('Режиссёр', 'director', mDirector, (v) => (mDirector = v))}
					{@render modelBox('Фоллбэк (тёмные сцены)', 'fallback', mFallback, (v) => (mFallback = v))}
					{@render modelBox('NPC-спавн', 'npc', mNpc, (v) => (mNpc = v))}
				</div>

				<div class="admin-block">
					<div class="block-title mono">Ключи OpenRouter по ролям</div>
					<p class="hint">Введите ключ, чтобы задать/заменить. Пустое поле — не менять. ✕ — сбросить.</p>
					{#snippet keyRow(label: string, role: 'default' | 'narrator' | 'validator' | 'director' | 'fallback' | 'npc', value: string, set: (v: string) => void)}
						<label class="arow">
							<span>{label}</span>
							<input
								type="password"
								class="mono"
								placeholder={adminView!.keysSet[role] ? 'задан' : 'не задан'}
								value={value}
								oninput={(e) => set((e.currentTarget as HTMLInputElement).value)}
							/>
							{#if adminView!.overridden.keys.includes(role)}
								<button class="clear" title="Сбросить" onclick={() => clearKey(role)} disabled={adminBusy}>✕</button>
							{/if}
						</label>
					{/snippet}
					{@render keyRow('Общий', 'default', kDefault, (v) => (kDefault = v))}
					{@render keyRow('Ведущий', 'narrator', kNarrator, (v) => (kNarrator = v))}
					{@render keyRow('Валидатор', 'validator', kValidator, (v) => (kValidator = v))}
					{@render keyRow('Режиссёр', 'director', kDirector, (v) => (kDirector = v))}
					{@render keyRow('Фоллбэк', 'fallback', kFallback, (v) => (kFallback = v))}
					{@render keyRow('NPC-спавн', 'npc', kNpc, (v) => (kNpc = v))}
				</div>

				<div class="admin-actions">
					<button class="save" onclick={adminSave} disabled={adminBusy}>{adminBusy ? 'Сохраняю…' : 'Сохранить и применить'}</button>
					{#if adminMsg}<span class="ok mono">✓ {adminMsg}</span>{/if}
					{#if adminErr}<span class="err mono">✕ {adminErr}</span>{/if}
				</div>
			{/if}
		{/if}
	</div>

	<p class="note">
		Ключи и модели задаются здесь и хранятся в БД сервера — файл <code class="mono">.env</code> не нужен.
		Клиент тонкий: секреты в браузере не хранятся. Доступ к серверу ограничивайте сетью (Tailscale)
		или обратным прокси с авторизацией (Caddy) — отдельного пароля у админки нет.
	</p>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 10; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(94vw, 560px); max-height: 90vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem clamp(1.2rem, 2.5vw, 1.8rem) 1.4rem; z-index: 11; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
	header h2 { margin: 0; font-size: 1.2rem; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; }
	.field { display: flex; flex-direction: column; gap: .4rem; margin-bottom: 1rem; }
	.field > span { color: var(--text-dim); font-size: .85em; }
	.field.row { flex-direction: row; align-items: center; justify-content: space-between; }
	input, select { background: var(--field, var(--surface-raised)); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: .45rem .6rem; font: inherit; }
	input[type='range'] { flex: 1; margin: 0 .6rem; }
	.probe { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; }
	.probe button { background: var(--surface-raised); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: .4rem .8rem; }
	.ok { color: var(--accent); font-size: .82em; }
	.err { color: var(--danger); font-size: .82em; }
	.models { list-style: none; padding: .6rem .8rem; margin: .6rem 0 0; background: var(--field, var(--surface-raised)); border-radius: 6px; font-size: .72em; color: var(--text-dim); }
	.models li { margin-bottom: .2rem; overflow-wrap: anywhere; }
	.val { min-width: 3ch; color: var(--text-dim); }
	.note { font-size: .78em; color: var(--text-dim); border-top: 1px solid var(--border); padding-top: .8rem; margin: 1rem 0 0; }
	code { font-family: var(--font-mono); background: var(--field, var(--surface-raised)); padding: .05rem .3rem; border-radius: 4px; }

	.admin { border-top: 1px solid var(--border); margin-top: 1rem; padding-top: .8rem; }
	.admin-toggle { background: none; border: none; color: var(--warm); font-size: .8rem; text-transform: uppercase; letter-spacing: .12em; font-family: var(--font-mono); padding: 0; }
	.hint { font-size: .76em; color: var(--text-dim); margin: .5rem 0; line-height: 1.4; }
	.retry { background: none; border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: .1rem .5rem; font-size: .8em; }
	.admin-block { margin: .8rem 0; }
	.block-title { font-size: .68rem; text-transform: uppercase; letter-spacing: .14em; color: var(--warm); margin-bottom: .4rem; }
	.arow { display: flex; align-items: center; gap: .6rem; margin-bottom: .4rem; }
	.arow > span { flex: 0 0 9rem; font-size: .82em; color: var(--text-dim); }
	.arow input { flex: 1; min-width: 0; }
	.model-block { margin-bottom: .6rem; }
	.model-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: .2rem; }
	.ml { font-size: .8em; color: var(--text-dim); }
	.reset { background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px; font-size: .68rem; padding: .1rem .5rem; }
	.reset:hover { color: var(--accent); border-color: var(--accent); }
	.model-block textarea { width: 100%; resize: vertical; background: var(--field, var(--surface-raised)); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: .4rem .55rem; font-size: .76em; line-height: 1.55; }
	.clear { background: none; border: 1px solid var(--border); color: var(--danger); border-radius: 6px; padding: .2rem .5rem; flex-shrink: 0; }
	.admin-actions { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; margin-top: .6rem; }
	.save { background: var(--accent); color: var(--on-accent); border: none; border-radius: 6px; padding: .5rem 1rem; }
</style>
