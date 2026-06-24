<script lang="ts">
	import type { ChronicleEntry } from '$lib/session.svelte';

	interface Props {
		entries: ChronicleEntry[];
		thinking?: boolean;
	}
	let { entries, thinking = false }: Props = $props();

	let scroller: HTMLDivElement | undefined = $state();

	// Автопрокрутка вниз при появлении/росте контента.
	$effect(() => {
		const last = entries[entries.length - 1];
		void entries.length;
		void last?.text;
		void thinking;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});
</script>

<div class="scroller" bind:this={scroller}>
	<div class="measure">
		{#if entries.length === 0}
			<div class="empty">
				<div class="rule-kicker">
					<span class="line"></span>
					<span class="mono">Упорядоченное</span>
					<span class="line"></span>
				</div>
				<h1>Хроника пуста</h1>
				<p class="lead">
					Здесь начнётся твоя история. Опиши, кто ты и где ты, или просто скажи мастеру: «начнём».
				</p>
				<p class="hint mono">Что ты делаешь?</p>
			</div>
		{:else}
			<div class="chron-title">Хроника</div>
		{/if}

		{#each entries as entry (entry.id)}
			<article class="entry {entry.speaker}" class:streaming={entry.streaming}>
				{#if entry.speaker === 'player'}
					<div class="role mono">Ты</div>
					<div class="body">
						{#each entry.text.split('\n\n') as para, i (i)}<p>{para}</p>{/each}
					</div>
				{:else if entry.speaker === 'master'}
					<div class="gm-head">
						<span class="avatar">◈</span>
						<span class="mono label">Мастер</span>
					</div>
					<div class="body">
						{#each entry.text.split('\n\n') as para, i (i)}<p>{para}</p>{/each}
						{#if entry.streaming && entry.text.length === 0}
							<div class="thinking">
								<span class="avatar ghost">✎</span>
								<span class="t">Мастер пишет</span>
								<span class="dots"><i></i><i></i><i></i></span>
							</div>
						{/if}
					</div>
					{#if entry.model && !entry.streaming}
						<div class="meta mono">{entry.model}</div>
					{/if}
				{:else}
					<div class="sys mono"><span class="glyph">⟐</span><span>{entry.text}</span></div>
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
		padding: clamp(1.5rem, 4vw, 2.4rem) var(--gutter) 2rem;
	}

	.empty {
		margin-top: 11vh;
		text-align: center;
		color: var(--text-dim);
	}
	.rule-kicker {
		display: inline-flex;
		align-items: center;
		gap: 16px;
		color: var(--warm);
		margin-bottom: 16px;
	}
	.rule-kicker .line {
		width: 40px;
		height: 1px;
		background: var(--warm);
		opacity: 0.5;
	}
	.rule-kicker .mono {
		font-size: 0.7rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
	}
	.empty h1 {
		color: var(--text);
		font-size: 2.2rem;
		margin: 0 0 0.6rem;
	}
	.empty .lead {
		font-size: 1.06rem;
		font-style: italic;
		max-width: 440px;
		margin: 0.4rem auto 0;
		line-height: 1.65;
	}
	.empty .hint {
		margin-top: 1.5rem;
		color: var(--accent);
		font-size: 0.85rem;
	}

	/* Заголовок «Хроника» над лентой. */
	.chron-title {
		text-align: center;
		font-family: var(--font-display);
		font-size: 0.82rem;
		letter-spacing: 0.42em;
		text-transform: uppercase;
		color: var(--text-dim);
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--rule);
		margin-bottom: 2rem;
	}

	.entry {
		margin-bottom: 1.9rem;
		animation: mfade 0.4s ease both;
	}
	.entry .body p {
		margin: 0 0 0.9rem;
	}
	.entry .body p:last-child {
		margin-bottom: 0;
	}

	/* — Реплика игрока — левая бирюзовая черта, мет­ка-моно, курсив Lora. — */
	.entry.player {
		border-left: 2px solid var(--accent);
		padding: 1px 0 1px 16px;
	}
	.entry.player .role {
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-dim);
		margin-bottom: 5px;
	}
	.entry.player .body {
		font-style: italic;
		font-size: 1.02em;
		line-height: 1.6;
		color: var(--text);
	}

	/* — Проза мастера — заголовок с аватаром + буквица. — */
	.entry.master .gm-head {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-bottom: 12px;
	}
	.entry.master .avatar {
		width: 24px;
		height: 24px;
		border-radius: 5px;
		background: var(--accent);
		color: var(--on-accent);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		flex-shrink: 0;
	}
	.entry.master .label {
		font-size: 0.62rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	.entry.master .body {
		font-size: 1.08em;
		line-height: 1.78;
		color: var(--text);
		hyphens: auto;
	}
	/* Буквица: первая буква первого абзаца. */
	.entry.master .body p:first-child::first-letter {
		float: left;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 3.4em;
		line-height: 0.72;
		color: var(--warm);
		padding: 0.06em 0.14em 0 0;
	}

	/* — Системная строка — */
	.entry.system .sys {
		display: flex;
		align-items: flex-start;
		gap: 9px;
		font-size: 0.8rem;
		color: var(--accent);
	}
	.entry.system .glyph {
		opacity: 0.7;
	}

	.thinking {
		display: flex;
		align-items: center;
		gap: 9px;
		opacity: 0.8;
		color: var(--text-dim);
		font-style: italic;
	}
	.thinking .ghost {
		background: transparent;
		border: 1px solid var(--chip-br);
		color: var(--text-dim);
	}
	.thinking .dots {
		display: inline-flex;
		gap: 3px;
	}
	.thinking .dots i {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--text-dim);
		animation: mblink 1.2s infinite;
	}
	.thinking .dots i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.thinking .dots i:nth-child(3) {
		animation-delay: 0.4s;
	}

	.meta {
		margin-top: 0.5rem;
		font-size: 0.66rem;
		color: var(--text-dim);
		opacity: 0.6;
		padding-left: 33px;
	}

	/* «Оседание чернил»: курсор в конце стримящейся прозы. */
	.entry.master.streaming .body p:last-child::after {
		content: '▍';
		color: var(--accent);
		margin-left: 1px;
		animation: mblink 1s steps(2) infinite;
	}
</style>
