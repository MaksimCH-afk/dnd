<script lang="ts">
	import { campaigns, switchCampaign, deleteCampaign } from '$lib/game.svelte';

	interface Props {
		onclose: () => void;
		onnew: () => void;
		onswitched: () => void;
	}
	let { onclose, onnew, onswitched }: Props = $props();

	async function pick(id: string) {
		if (id === campaigns.activeId) return onclose();
		await switchCampaign(id);
		onswitched();
	}
	async function remove(id: string, e: Event) {
		e.stopPropagation();
		await deleteCampaign(id);
	}
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Кампании" aria-modal="true">
	<header>
		<h2>Кампании</h2>
		<button class="close" onclick={onclose} aria-label="Закрыть">✕</button>
	</header>

	{#if campaigns.campaigns.length === 0}
		<p class="empty">Пока нет ни одной кампании.</p>
	{:else}
		<ul class="list">
			{#each campaigns.campaigns as c (c.id)}
				<li class:active={c.id === campaigns.activeId}>
					<button class="pick" onclick={() => pick(c.id)}>
						<span class="name">{c.name}</span>
						{#if c.id === campaigns.activeId}<span class="badge mono">активна</span>{/if}
						<span class="cid mono">{c.id}</span>
					</button>
					<button class="del" onclick={(e) => remove(c.id, e)} aria-label="Удалить" title="Удалить кампанию">🗑</button>
				</li>
			{/each}
		</ul>
	{/if}

	<button class="newgame" onclick={onnew}>+ Новая кампания</button>
	<small class="note">Каждая кампания — отдельный персонаж/прохождение со своим слотом. С git каждая синхронизируется в свою ветку.</small>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 10; }
	.panel {
		position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
		width: min(92vw, 440px); max-height: 86vh; overflow-y: auto;
		background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
		padding: 1.2rem 1.4rem 1.4rem; z-index: 11; box-shadow: 0 20px 60px rgba(0,0,0,.5);
	}
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
	header h2 { margin: 0; font-size: 1.2rem; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; }
	.empty { color: var(--text-dim); font-size: .9em; }
	.list { list-style: none; padding: 0; margin: 0 0 1rem; display: flex; flex-direction: column; gap: .5rem; }
	.list li { display: flex; gap: .5rem; align-items: stretch; }
	.pick {
		flex: 1; text-align: left; background: var(--ink-900); border: 1px solid var(--border);
		border-radius: 8px; padding: .6rem .8rem; color: var(--text); display: flex; flex-direction: column; gap: .2rem;
	}
	.list li.active .pick { border-color: var(--accent); }
	.name { font-size: 1em; }
	.badge { font-size: .68em; color: var(--accent); }
	.cid { font-size: .68em; color: var(--text-dim); }
	.del { background: var(--surface-raised); border: 1px solid var(--border); border-radius: 8px; color: var(--text-dim); padding: 0 .7rem; }
	.del:hover { color: var(--danger); }
	.newgame {
		width: 100%; background: var(--accent); color: var(--ink-900); border: none;
		border-radius: var(--radius); padding: .6rem; font-size: .95em;
	}
	.note { display: block; margin-top: .8rem; font-size: .75em; color: var(--text-dim); line-height: 1.4; }
</style>
