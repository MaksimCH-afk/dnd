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

	// --- Администрирование (ключи/модели по ролям) ---
	let adminOpen = $state(false);
	let adminPass = $state('');
	let adminView = $state<AdminConfigView | null>(null);
	let adminErr = $state('');
	let adminMsg = $state('');
	let adminBusy = $state(false);
	let adminConfigured = $state<boolean | null>(null); // null = ещё не проверяли
	let newPass = $state('');
	let newPass2 = $state('');

	async function adminToggle() {
		adminOpen = !adminOpen;
		adminErr = '';
		if (adminOpen && adminConfigured === null) await adminCheckStatus();
	}

	async function adminCheckStatus() {
		adminBusy = true;
		adminErr = '';
		try {
			const s = await adminApi.status(settings.serverUrl);
			adminConfigured = s.configured;
			if (!s.dbReady) adminErr = 'БД сервера недоступна — настройки нельзя сохранить.';
		} catch (e) {
			adminErr = (e as Error).message;
		} finally {
			adminBusy = false;
		}
	}

	async function adminSetup() {
		adminErr = '';
		if (newPass.length < 4) { adminErr = 'пароль слишком короткий (минимум 4 символа)'; return; }
		if (newPass !== newPass2) { adminErr = 'пароли не совпадают'; return; }
		adminBusy = true;
		try {
			await adminApi.setPassword(settings.serverUrl, newPass);
			adminPass = newPass;
			adminConfigured = true;
			newPass = newPass2 = '';
			await adminLogin();
		} catch (e) {
			adminErr = (e as Error).message;
		} finally {
			adminBusy = false;
		}
	}

	// поля моделей (предзаполняются текущими), поля ключей (всегда пустые — секреты не показываем)
	let mNarrator = $state('');
	let mValidator = $state('');
	let mDirector = $state('');
	let mFallback = $state('');
	let kDefault = $state('');
	let kNarrator = $state('');
	let kValidator = $state('');
	let kDirector = $state('');
	let kFallback = $state('');

	function fillModels(v: AdminConfigView) {
		mNarrator = v.models.narrator;
		mValidator = v.models.validator;
		mDirector = v.models.director;
		mFallback = v.models.fallback;
	}

	async function adminLogin() {
		adminErr = '';
		adminMsg = '';
		adminBusy = true;
		try {
			adminView = await adminApi.get(settings.serverUrl, adminPass);
			fillModels(adminView);
		} catch (e) {
			adminErr = (e as Error).message;
			adminView = null;
		} finally {
			adminBusy = false;
		}
	}

	async function adminSave() {
		adminErr = '';
		adminMsg = '';
		adminBusy = true;
		const patch: AdminConfigPatch = {
			// модели шлём как есть (пусто = вернуть к env)
			models: { narrator: mNarrator, validator: mValidator, director: mDirector, fallback: mFallback },
			// ключи: только непустые (введён новый секрет); пустое поле не трогает текущий
			keys: {}
		};
		if (kDefault.trim()) patch.keys!.default = kDefault.trim();
		if (kNarrator.trim()) patch.keys!.narrator = kNarrator.trim();
		if (kValidator.trim()) patch.keys!.validator = kValidator.trim();
		if (kDirector.trim()) patch.keys!.director = kDirector.trim();
		if (kFallback.trim()) patch.keys!.fallback = kFallback.trim();
		try {
			adminView = await adminApi.save(settings.serverUrl, adminPass, patch);
			fillModels(adminView);
			kDefault = kNarrator = kValidator = kDirector = kFallback = '';
			adminMsg = 'Сохранено и применено.';
		} catch (e) {
			adminErr = (e as Error).message;
		} finally {
			adminBusy = false;
		}
	}

	async function clearKey(role: 'default' | 'narrator' | 'validator' | 'director' | 'fallback') {
		adminBusy = true;
		adminErr = '';
		adminMsg = '';
		try {
			adminView = await adminApi.save(settings.serverUrl, adminPass, { keys: { [role]: '' } });
			adminMsg = `Ключ роли «${role}» сброшен к серверному (.env).`;
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

	<!-- Администрирование: ключи и модели по ролям (на сервере, под паролем) -->
	<div class="admin">
		<button class="admin-toggle" onclick={adminToggle}>
			<span>{adminOpen ? '▾' : '▸'} Администрирование — ключи и модели</span>
		</button>
		{#if adminOpen}
			{#if adminConfigured === null}
				<p class="hint">Проверяю сервер…</p>
				{#if adminErr}<span class="err mono">✕ {adminErr}</span>{/if}
			{:else if !adminConfigured}
				<p class="hint">Первый запуск: задайте пароль администратора. Он хранится на сервере (в БД, хешем) — не в файлах. Дальше под ним правятся ключи и модели.</p>
				<label class="arow"><span>Новый пароль</span><input type="password" class="mono" bind:value={newPass} placeholder="мин. 4 символа" /></label>
				<label class="arow"><span>Ещё раз</span><input type="password" class="mono" bind:value={newPass2} /></label>
				<div class="admin-actions">
					<button class="save" onclick={adminSetup} disabled={adminBusy || !newPass}>{adminBusy ? '…' : 'Задать пароль'}</button>
					{#if adminErr}<span class="err mono">✕ {adminErr}</span>{/if}
				</div>
			{:else if !adminView}
				<p class="hint">Введите пароль администратора. Секреты остаются на сервере (в браузер не возвращаются).</p>
				<div class="probe">
					<input type="password" class="mono" bind:value={adminPass} placeholder="пароль администратора" />
					<button onclick={adminLogin} disabled={adminBusy || !adminPass}>{adminBusy ? '…' : 'Войти'}</button>
				</div>
				{#if adminErr}<span class="err mono">✕ {adminErr}</span>{/if}
			{:else}
				<div class="admin-block">
					<div class="block-title mono">Модели по ролям</div>
					<p class="hint">ID модели OpenRouter (см. справку 💳). Пусто — вернуть к серверному дефолту.</p>
					<label class="arow"><span>Ведущий</span><input class="mono" bind:value={mNarrator} placeholder="qwen/…" /></label>
					<label class="arow"><span>Валидатор</span><input class="mono" bind:value={mValidator} /></label>
					<label class="arow"><span>Режиссёр</span><input class="mono" bind:value={mDirector} /></label>
					<label class="arow"><span>Фоллбэк</span><input class="mono" bind:value={mFallback} /></label>
				</div>

				<div class="admin-block">
					<div class="block-title mono">Ключи OpenRouter по ролям</div>
					<p class="hint">Введите новый ключ, чтобы заменить. Пустое поле — не менять. ✕ — сбросить к серверному (.env).</p>
					{#snippet keyRow(label: string, role: 'default' | 'narrator' | 'validator' | 'director' | 'fallback', value: string, set: (v: string) => void)}
						<label class="arow">
							<span>{label}</span>
							<input
								type="password"
								class="mono"
								placeholder={adminView!.keysSet[role] ? (adminView!.overridden.keys.includes(role) ? 'задан (админка)' : 'задан (сервер)') : 'не задан'}
								value={value}
								oninput={(e) => set((e.currentTarget as HTMLInputElement).value)}
							/>
							{#if adminView!.overridden.keys.includes(role)}
								<button class="clear" title="Сбросить к .env" onclick={() => clearKey(role)} disabled={adminBusy}>✕</button>
							{/if}
						</label>
					{/snippet}
					{@render keyRow('Общий', 'default', kDefault, (v) => (kDefault = v))}
					{@render keyRow('Ведущий', 'narrator', kNarrator, (v) => (kNarrator = v))}
					{@render keyRow('Валидатор', 'validator', kValidator, (v) => (kValidator = v))}
					{@render keyRow('Режиссёр', 'director', kDirector, (v) => (kDirector = v))}
					{@render keyRow('Фоллбэк', 'fallback', kFallback, (v) => (kFallback = v))}
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
		Ключи, модели и пароль администратора задаются здесь и хранятся в БД сервера —
		файл <code class="mono">.env</code> не нужен. Клиент тонкий: секреты в браузере не хранятся.
	</p>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 10; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(92vw, 480px); max-height: 88vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem 1.4rem 1.4rem; z-index: 11; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
	header h2 { margin: 0; font-size: 1.2rem; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; }
	.field { display: flex; flex-direction: column; gap: .4rem; margin-bottom: 1rem; }
	.field > span { color: var(--text-dim); font-size: .85em; }
	.field.row { flex-direction: row; align-items: center; justify-content: space-between; }
	input, select { background: var(--field, var(--surface-raised)); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: .45rem .6rem; font: inherit; }
	input[type='range'] { flex: 1; margin: 0 .6rem; }
	.probe { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; }
	.probe input { flex: 1; min-width: 10rem; }
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
	.admin-block { margin: .8rem 0; }
	.block-title { font-size: .68rem; text-transform: uppercase; letter-spacing: .14em; color: var(--warm); margin-bottom: .4rem; }
	.arow { display: flex; align-items: center; gap: .6rem; margin-bottom: .4rem; }
	.arow > span { flex: 0 0 9rem; font-size: .82em; color: var(--text-dim); }
	.arow input { flex: 1; min-width: 0; }
	.clear { background: none; border: 1px solid var(--border); color: var(--danger); border-radius: 6px; padding: .2rem .5rem; flex-shrink: 0; }
	.admin-actions { display: flex; align-items: center; gap: .7rem; flex-wrap: wrap; margin-top: .6rem; }
	.save { background: var(--accent); color: var(--on-accent); border: none; border-radius: 6px; padding: .5rem 1rem; }
</style>
