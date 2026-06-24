<script lang="ts">
	import {
		createCharacter,
		RACES,
		AGE_BANDS,
		DIRECTIONS,
		DARK_PATH_DIRECTIONS,
		type CreationChoices,
		type GameState
	} from '@rpg/engine';

	interface Props {
		oncreated: (state: GameState) => void;
		oncancel: () => void;
	}
	let { oncreated, oncancel }: Props = $props();

	let name = $state('');
	let race = $state<CreationChoices['race']>('человек');
	let age_band = $state<CreationChoices['age_band']>('зрелый');
	let direction = $state<CreationChoices['direction']>('наёмник');
	let darkPath = $state(false);

	const canDark = $derived(DARK_PATH_DIRECTIONS.includes(direction));
	const valid = $derived(name.trim().length > 0);

	function create() {
		if (!valid) return;
		const choices: CreationChoices = {
			name: name.trim(),
			race,
			age_band,
			direction,
			...(canDark && darkPath ? { darkPath: true } : {})
		};
		oncreated(createCharacter(choices));
	}
</script>

<div class="backdrop" role="presentation"></div>
<div class="panel" role="dialog" aria-label="Создание персонажа" aria-modal="true">
	<header>
		<h2>Новая игра</h2>
		<button class="close" onclick={oncancel} aria-label="Отмена">✕</button>
	</header>

	<p class="intro">
		Персонаж уже живёт в мире: есть прошлое, базовое знание, причина быть здесь.
		Старт — способный, но не прокачанный. Атрибуты, HP и проверку таланта движок
		бросает скрыто.
	</p>

	<label class="field">
		<span>Имя</span>
		<input bind:value={name} placeholder="Как зовут героя?" />
	</label>

	<label class="field">
		<span>Раса</span>
		<select bind:value={race}>
			{#each RACES as r (r)}<option value={r}>{r}</option>{/each}
		</select>
	</label>

	<label class="field">
		<span>Возраст</span>
		<select bind:value={age_band}>
			{#each AGE_BANDS as a (a)}<option value={a}>{a}</option>{/each}
		</select>
	</label>

	<label class="field">
		<span>Направление (прожитая жизнь)</span>
		<select bind:value={direction}>
			{#each DIRECTIONS as d (d)}<option value={d}>{d}</option>{/each}
		</select>
	</label>

	{#if canDark}
		<label class="check">
			<input type="checkbox" bind:checked={darkPath} />
			<span>Тёмная дорожка магии (кровавая/тёмная) — тень нависает с самого начала</span>
		</label>
	{/if}

	<div class="actions">
		<button class="ghost" onclick={oncancel}>Отмена</button>
		<button class="primary" onclick={create} disabled={!valid}>Создать и начать</button>
	</div>
	<small class="note">
		Магия включается только если направление к ней предрасположено (академик, жрец,
		отшельник) и пройдёт скрытая проверка таланта. Иначе — полноценная сборка без магии.
	</small>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 10;
	}
	.panel {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(92vw, 440px);
		max-height: 88vh;
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
		margin-bottom: 0.6rem;
	}
	header h2 {
		margin: 0;
		font-size: 1.3rem;
	}
	.close {
		background: none;
		border: none;
		color: var(--text-dim);
		font-size: 1.1rem;
	}
	.intro {
		font-size: 0.82em;
		color: var(--text-dim);
		line-height: 1.5;
		margin: 0 0 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.9rem;
	}
	.field > span {
		font-size: 0.85em;
		color: var(--text-dim);
	}
	input,
	select {
		background: var(--surface-raised);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		font: inherit;
	}
	.check {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		font-size: 0.85em;
		color: var(--text-dim);
		margin-bottom: 1rem;
		line-height: 1.4;
	}
	.check input {
		margin-top: 0.2rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
		margin-top: 0.5rem;
	}
	.actions button {
		border-radius: var(--radius);
		padding: 0.55rem 1.1rem;
		border: 1px solid var(--border);
		font-size: 0.95em;
	}
	.ghost {
		background: var(--surface-raised);
		color: var(--text);
	}
	.primary {
		background: var(--accent);
		color: var(--ink-900);
		border: none;
	}
	.primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.note {
		display: block;
		margin-top: 0.9rem;
		font-size: 0.75em;
		color: var(--text-dim);
		line-height: 1.4;
	}
</style>
