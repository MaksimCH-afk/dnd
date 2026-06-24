<script lang="ts">
	import { untrack } from 'svelte';
	import { verifyKey } from '$lib/llm';

	interface Props {
		label: string;
		hint?: string;
		initial: string;
		proxyUrl: string;
		placeholder?: string;
		onsave: (value: string) => void;
		ondelete: () => void;
	}
	let { label, hint, initial, proxyUrl, placeholder = 'sk-or-v1-…', onsave, ondelete }: Props = $props();

	let draft = $state(untrack(() => initial));
	let show = $state(false);
	let verifying = $state(false);
	let status = $state<{ ok: boolean; text: string } | null>(null);

	function save() {
		onsave(draft);
		status = { ok: true, text: 'сохранён' };
	}
	function del() {
		ondelete();
		draft = '';
		status = null;
	}
	async function check() {
		verifying = true;
		status = null;
		try {
			const r = await verifyKey(proxyUrl, draft.trim());
			status = r.ok
				? { ok: true, text: `действителен${r.modelCount ? ` · ${r.modelCount} моделей` : ''}` }
				: { ok: false, text: r.error ?? 'отклонён' };
		} catch (e) {
			status = { ok: false, text: (e as Error).message };
		} finally {
			verifying = false;
		}
	}
</script>

<div class="keyrowblock">
	<div class="lab">
		<span class="label">{label}</span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</div>
	<div class="inrow">
		<input
			class="mono"
			type={show ? 'text' : 'password'}
			bind:value={draft}
			{placeholder}
			autocomplete="off"
			spellcheck="false"
		/>
		<button class="ghost" onclick={() => (show = !show)} aria-label="Показать/скрыть">{show ? '🙈' : '👁'}</button>
	</div>
	<div class="acts">
		<button onclick={save} disabled={draft.trim() === initial.trim()}>Сохранить</button>
		<button onclick={check} disabled={verifying || !draft.trim()}>{verifying ? '…' : 'Проверить'}</button>
		<button class="danger" onclick={del} disabled={!draft && !initial}>Удалить</button>
		{#if status}<span class="mono" class:ok={status.ok} class:err={!status.ok}>{status.ok ? '✓' : '✕'} {status.text}</span>{/if}
	</div>
</div>

<style>
	.keyrowblock { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
	.lab { display: flex; flex-direction: column; margin-bottom: 0.35rem; }
	.label { font-size: 0.88em; }
	.hint { font-size: 0.72em; color: var(--text-dim); }
	.inrow { display: flex; gap: 0.4rem; }
	.inrow input { flex: 1; min-width: 0; background: var(--surface-raised); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem 0.6rem; font: inherit; }
	.ghost { background: var(--surface-raised); border: 1px solid var(--border); border-radius: 6px; padding: 0 0.6rem; }
	.acts { display: flex; gap: 0.4rem; margin-top: 0.4rem; flex-wrap: wrap; align-items: center; }
	.acts button { background: var(--surface-raised); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 0.3rem 0.7rem; font-size: 0.82em; }
	.acts button:disabled { opacity: 0.4; cursor: not-allowed; }
	.acts .danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
	.ok { color: var(--accent); font-size: 0.8em; }
	.err { color: var(--danger); font-size: 0.8em; }
</style>
