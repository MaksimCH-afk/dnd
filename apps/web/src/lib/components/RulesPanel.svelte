<script lang="ts">
	import { RULE_FILES, RULE_TITLES, type RuleName } from '@rpg/engine';
	import { rulesState, setRule, resetRule, getRuleContent } from '$lib/rules.svelte';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let viewing = $state<RuleName | null>(null);
	let busy = $state<RuleName | null>(null);

	function fmtBytes(n: number): string {
		return n < 1024 ? `${n} Б` : `${(n / 1024).toFixed(1)} КБ`;
	}

	async function onUpload(name: RuleName, e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		busy = name;
		try {
			const text = await file.text();
			await setRule(name, text);
		} finally {
			busy = null;
			input.value = '';
		}
	}

	async function onReset(name: RuleName) {
		busy = name;
		try {
			await resetRule(name);
		} finally {
			busy = null;
		}
	}
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Файлы правил" aria-modal="true">
	<header>
		<h2>Файлы правил</h2>
		<button class="close" onclick={onclose} aria-label="Закрыть">✕</button>
	</header>

	<p class="intro">
		Основа всей механики. Загрузите новую версию любого файла — она переопределит
		встроенную без пересборки. Канон состояния хранится отдельно и не затрагивается.
	</p>

	{#if !rulesState.ready}
		<p class="loading mono">Загрузка…</p>
	{:else}
		<ul class="list">
			{#each RULE_FILES as name (name)}
				{@const entry = rulesState.entries[name]}
				<li>
					<div class="head">
						<div class="title">
							<b>{name}.md</b>
							<span class="sub">{RULE_TITLES[name]}</span>
						</div>
						<span class="badge" class:uploaded={entry?.source === 'uploaded'}>
							{entry?.source === 'uploaded' ? 'загружен' : 'встроен'}
						</span>
					</div>
					<div class="meta mono">
						{entry ? fmtBytes(entry.bytes) : '—'}
						{#if entry?.source === 'uploaded'}· {entry.version}{/if}
					</div>
					<div class="actions">
						<button onclick={() => (viewing = viewing === name ? null : name)}>
							{viewing === name ? 'Скрыть' : 'Просмотр'}
						</button>
						<label class="upload">
							{busy === name ? '…' : 'Заменить'}
							<input type="file" accept=".md,text/markdown,text/plain" onchange={(e) => onUpload(name, e)} hidden />
						</label>
						{#if entry?.source === 'uploaded'}
							<button class="reset" onclick={() => onReset(name)} disabled={busy === name}>Сбросить</button>
						{/if}
					</div>
					{#if viewing === name}
						<pre class="preview mono">{getRuleContent(name)}</pre>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
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
		width: min(94vw, 620px);
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
		font-size: 1.2rem;
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
		margin: 0 0 1rem;
		line-height: 1.5;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.list li {
		background: var(--ink-900);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.7rem 0.9rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.6rem;
	}
	.title b {
		font-family: var(--font-mono);
	}
	.title .sub {
		display: block;
		font-size: 0.78em;
		color: var(--text-dim);
		margin-top: 0.15rem;
	}
	.badge {
		flex-shrink: 0;
		font-size: 0.7em;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-raised);
		color: var(--text-dim);
		border: 1px solid var(--border);
	}
	.badge.uploaded {
		color: var(--accent);
		border-color: var(--accent);
	}
	.meta {
		font-size: 0.72em;
		color: var(--text-dim);
		margin: 0.35rem 0 0.5rem;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.actions button,
	.upload {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 6px;
		padding: 0.3rem 0.7rem;
		font-size: 0.82em;
		cursor: pointer;
	}
	.upload {
		display: inline-flex;
		align-items: center;
	}
	.actions .reset {
		color: var(--text-dim);
	}
	.preview {
		margin-top: 0.7rem;
		max-height: 320px;
		overflow: auto;
		background: #000;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.7rem;
		font-size: 0.72em;
		line-height: 1.4;
		color: var(--vellum-300);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.loading {
		color: var(--text-dim);
	}
</style>
