<script lang="ts">
	import { auth, login, setupAuth } from '$lib/auth.svelte';

	let user = $state('');
	let password = $state('');
	let password2 = $state('');
	let busy = $state(false);
	let error = $state('');

	const setup = $derived(!auth.configured);

	async function submit(e?: Event) {
		e?.preventDefault();
		error = '';
		if (busy) return;
		if (setup) {
			if (user.trim().length < 2) { error = 'логин — минимум 2 символа'; return; }
			if (password.length < 4) { error = 'пароль — минимум 4 символа'; return; }
			if (password !== password2) { error = 'пароли не совпадают'; return; }
		}
		busy = true;
		try {
			if (setup) await setupAuth(user.trim(), password);
			else await login(user.trim(), password);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="gate">
	<form class="card" onsubmit={submit}>
		<div class="kicker">
			<span class="line"></span>
			<span class="mono">Упорядоченное</span>
			<span class="line"></span>
		</div>
		<h1>Хроника</h1>
		<p class="lead">{setup ? 'Первый вход — задайте логин и пароль. Они сохранятся на сервере.' : 'Вход в игру.'}</p>

		<label>
			<span class="mono">Логин</span>
			<input bind:value={user} autocomplete="username" placeholder="ваш логин" />
		</label>
		<label>
			<span class="mono">Пароль</span>
			<input type="password" bind:value={password} autocomplete={setup ? 'new-password' : 'current-password'} placeholder="пароль" />
		</label>
		{#if setup}
			<label>
				<span class="mono">Пароль ещё раз</span>
				<input type="password" bind:value={password2} autocomplete="new-password" placeholder="повторите пароль" />
			</label>
		{/if}

		{#if error}<p class="err mono">✕ {error}</p>{/if}

		<button class="go" type="submit" disabled={busy || !user || !password}>
			{busy ? '…' : setup ? 'Создать и войти' : 'Войти'}
		</button>
	</form>
</div>

<style>
	.gate {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg);
		background-attachment: fixed;
		padding: 1.5rem;
		z-index: 40;
	}
	.card {
		width: min(94vw, 380px);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		padding: clamp(1.4rem, 4vw, 2.2rem);
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
		text-align: center;
	}
	.kicker {
		display: inline-flex;
		align-items: center;
		gap: 14px;
		color: var(--warm);
		margin-bottom: 14px;
	}
	.kicker .line { width: 34px; height: 1px; background: var(--warm); opacity: 0.5; }
	.kicker .mono { font-size: 0.66rem; letter-spacing: 0.34em; text-transform: uppercase; }
	h1 {
		font-family: var(--font-display);
		font-size: 2.4rem;
		color: var(--text);
		margin: 0 0 0.4rem;
	}
	.lead { font-size: 0.9rem; font-style: italic; color: var(--text-dim); margin: 0 0 1.4rem; line-height: 1.5; }
	label { display: block; text-align: left; margin-bottom: 0.8rem; }
	label > span { display: block; font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.3rem; }
	input {
		width: 100%;
		background: var(--field, var(--surface-raised));
		color: var(--text);
		border: 1px solid var(--rule);
		border-radius: 8px;
		padding: 0.6rem 0.7rem;
		font: inherit;
		outline: none;
	}
	input:focus { border-color: var(--accent); }
	.err { color: var(--danger); font-size: 0.82em; margin: 0 0 0.6rem; }
	.go {
		width: 100%;
		margin-top: 0.4rem;
		background: var(--accent);
		color: var(--on-accent);
		border: none;
		border-radius: 10px;
		padding: 0.7rem;
		font-family: var(--font-mono);
		font-size: 0.9rem;
		letter-spacing: 0.04em;
	}
	.go:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
