<script lang="ts">
	import { moneyParts } from '$lib/status';

	interface Props {
		/** Сумма в медяках (MP). */
		mp: number;
		/** Размер: sm — для строк журнала/топбара, lg — крупный капитал. */
		size?: 'sm' | 'md' | 'lg';
		/** Показывать нулевые номиналы (по умолчанию скрываем). */
		full?: boolean;
	}
	let { mp, size = 'md', full = false }: Props = $props();
	const p = $derived(moneyParts(mp));
	// Если денег нет вовсе — показываем «0 меди», чтобы не было пусто.
	const showMp = $derived(full || p.mp > 0 || (p.gp === 0 && p.sp === 0));
</script>

<span class="coins {size}" aria-label="{p.gp} золотых, {p.sp} серебряных, {p.mp} медных">
	{#if full || p.gp > 0}
		<span class="coin gold" title="золото (GP)"><i></i>{p.gp}</span>
	{/if}
	{#if full || p.sp > 0}
		<span class="coin silver" title="серебро (SP)"><i></i>{p.sp}</span>
	{/if}
	{#if showMp}
		<span class="coin copper" title="медь (MP)"><i></i>{p.mp}</span>
	{/if}
</span>

<style>
	.coins {
		display: inline-flex;
		align-items: center;
		gap: 0.6em;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.coin {
		display: inline-flex;
		align-items: center;
		gap: 0.32em;
		color: var(--text);
	}
	.coin i {
		width: 0.92em;
		height: 0.92em;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25), 0 1px 1px rgba(0, 0, 0, 0.2);
	}
	.coin.gold i { background: radial-gradient(circle at 35% 30%, #f2d479, #c9a227 70%); }
	.coin.silver i { background: radial-gradient(circle at 35% 30%, #eef1f5, #aab2bd 72%); }
	.coin.copper i { background: radial-gradient(circle at 35% 30%, #e0a878, #a9602f 72%); }

	.sm { font-size: 0.82em; gap: 0.5em; }
	.sm .coin { gap: 0.28em; }
	.lg { font-size: 1.5rem; gap: 0.8em; font-weight: 600; }
</style>
