<script lang="ts">
	import type { ChronicleEntry } from '$lib/chronicle.svelte';

	interface Props {
		entries: ChronicleEntry[];
	}
	let { entries }: Props = $props();

	let scroller: HTMLDivElement | undefined = $state();

	// Автопрокрутка вниз при появлении/росте контента.
	$effect(() => {
		// зависимость от длины и текста последней записи
		const last = entries[entries.length - 1];
		void entries.length;
		void last?.text;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<div class="scroller" bind:this={scroller}>
	<div class="measure">
		{#if entries.length === 0}
			<div class="empty">
				<h1>Хроника пуста</h1>
				<p class="lead">
					Здесь начнётся твоя история. Опиши, кто ты и где ты, или просто скажи мастеру: «начнём».
				</p>
				<p class="hint mono">Что ты делаешь?</p>
			</div>
		{/if}

		{#each entries as entry (entry.id)}
			<article class="entry {entry.speaker}" class:streaming={entry.streaming}>
				{#if entry.speaker === 'player'}
					<span class="marker mono">›</span>
				{/if}
				<div class="body">
					{#each entry.text.split('\n\n') as para, i (i)}
						<p>{para}</p>
					{/each}
					{#if entry.streaming && entry.text.length === 0}
						<p class="thinking mono">Мастер пишет…</p>
					{/if}
				</div>
				{#if entry.model && !entry.streaming}
					<div class="meta mono">
						{entry.model}{entry.usedFallback ? ' · фоллбэк' : ''}
					</div>
				{/if}
			</article>
		{/each}
	</div>
</div>

<style>
	.scroller {
		flex: 1;
		overflow-y: auto;
		scroll-behavior: smooth;
	}
	.measure {
		max-width: var(--prose-measure);
		margin: 0 auto;
		padding: clamp(1.5rem, 4vw, 3rem) var(--gutter) 2rem;
	}
	.empty {
		margin-top: 12vh;
		text-align: center;
		color: var(--text-dim);
	}
	.empty h1 {
		color: var(--text);
		font-size: 1.6rem;
		margin-bottom: 0.6rem;
	}
	.empty .lead {
		font-size: 1.1rem;
	}
	.empty .hint {
		margin-top: 1.5rem;
		color: var(--accent);
	}

	.entry {
		margin-bottom: 1.8rem;
	}
	.entry .body p {
		margin: 0 0 0.9rem;
	}

	/* Реплика игрока — отступ и маркер, моноширинный голос «действия». */
	.entry.player {
		display: grid;
		grid-template-columns: 1.5rem 1fr;
		gap: 0.5rem;
		color: var(--moon-300);
		font-family: var(--font-mono);
		font-size: 0.95em;
	}
	.entry.player .marker {
		color: var(--accent);
		opacity: 0.7;
	}

	/* Проза мастера — основная антиква. */
	.entry.master .body {
		font-size: 1.08em;
		color: var(--vellum-100);
	}

	.entry.system .body {
		font-family: var(--font-mono);
		font-size: 0.88em;
		color: var(--text-dim);
		border-left: 2px solid var(--border);
		padding-left: 0.8rem;
	}

	.thinking {
		color: var(--text-dim);
		opacity: 0.8;
	}

	.meta {
		margin-top: 0.4rem;
		font-size: 0.72em;
		color: var(--text-dim);
		opacity: 0.6;
	}

	/* «Оседание чернил»: проступающий курсор в конце стримящейся прозы. */
	.entry.master.streaming .body p:last-child::after {
		content: '▍';
		color: var(--accent);
		margin-left: 1px;
		animation: blink 1s steps(2) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>
