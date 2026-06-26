<script lang="ts">
	import { listSnapshots, restoreSnapshot } from '$lib/session.svelte';
	import type { SnapshotRow } from '$lib/api';

	interface Props {
		onclose: () => void;
		onrestored?: () => void;
	}
	let { onclose, onrestored }: Props = $props();

	let rows = $state<SnapshotRow[] | null>(null);
	let err = $state('');
	let busy = $state(false);

	async function load() {
		err = '';
		try {
			rows = await listSnapshots();
		} catch (e) {
			err = (e as Error).message;
		}
	}
	$effect(() => {
		void load();
	});

	async function restore(id: number) {
		if (busy) return;
		busy = true;
		err = '';
		try {
			await restoreSnapshot(id);
			onrestored?.();
			onclose();
		} catch (e) {
			err = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function when(iso: string): string {
		try {
			return new Date(iso).toLocaleString('ru-RU');
		} catch {
			return iso;
		}
	}
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Точки сохранения" aria-modal="true">
	<header>
		<h2>Точки сохранения</h2>
		<button class="close" onclick={onclose} aria-label="Закрыть">✕</button>
	</header>
	<p class="hint">Восстановление вернёт игру к выбранной точке (честный «загруз»). Текущее несохранённое состояние будет перезаписано.</p>

	{#if err}<p class="err mono">✕ {err}</p>{/if}
	{#if !rows}
		<p class="hint">Загрузка…</p>
	{:else if rows.length === 0}
		<p class="hint">Пока нет точек. Они создаются автоматически по ходу игры и командой <code class="mono">/save</code>.</p>
	{:else}
		<ul class="list">
			{#each rows as s (s.id)}
				<li>
					<div class="meta">
						<span class="label">{s.label || `снапшот #${s.id}`}</span>
						<small class="mono">День {s.day} · {when(s.created_at)}</small>
					</div>
					<button class="restore" onclick={() => restore(s.id)} disabled={busy}>Восстановить</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 12; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(94vw, 520px); max-height: 90vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem clamp(1.2rem,2.5vw,1.8rem) 1.4rem; z-index: 13; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .6rem; }
	header h2 { margin: 0; font-size: 1.15rem; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; }
	.hint { font-size: .82em; color: var(--text-dim); line-height: 1.45; margin: .4rem 0; }
	.err { color: var(--danger); font-size: .82em; }
	.list { list-style: none; padding: 0; margin: .6rem 0 0; display: flex; flex-direction: column; gap: .4rem; }
	.list li { display: flex; align-items: center; justify-content: space-between; gap: .8rem; padding: .55rem .7rem; background: var(--field, var(--surface-raised)); border: 1px solid var(--border); border-radius: 8px; }
	.meta { display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
	.label { font-size: .9em; overflow-wrap: anywhere; }
	.meta small { color: var(--text-dim); font-size: .72em; }
	.restore { background: var(--accent); color: var(--on-accent); border: none; border-radius: 6px; padding: .35rem .8rem; font-size: .82em; flex-shrink: 0; }
	.restore:disabled { opacity: .5; }
	code { font-family: var(--font-mono); background: var(--field, var(--surface-raised)); padding: .05rem .3rem; border-radius: 4px; }
</style>
