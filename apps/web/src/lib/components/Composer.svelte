<script lang="ts">
	interface Props {
		busy: boolean;
		onsend: (text: string) => void;
	}
	let { busy, onsend }: Props = $props();

	let value = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	const commands = [
		{ cmd: '/go', hint: 'подтянуть состояние с сервера' },
		{ cmd: '/save', hint: 'сохранить канон (снапшот)' },
		{ cmd: '/ask', hint: 'спросить о механике (мета)' }
	];

	// Подсказка-меню команд при вводе «/…».
	const cmdMenu = $derived.by(() => {
		const t = value.trim().toLowerCase();
		if (!t.startsWith('/')) return [];
		return commands.filter((c) => t === '/' || c.cmd.startsWith(t.split(/\s/)[0]));
	});

	function submit() {
		const text = value.trim();
		if (!text || busy) return;
		onsend(text);
		value = '';
		autosize();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function insertCommand(cmd: string) {
		value = value.trim().length && !value.trim().startsWith('/') ? `${cmd} ${value.trim()}` : `${cmd} `;
		textarea?.focus();
		autosize();
	}

	function autosize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
	}
</script>

<div class="composer">
	<div class="inner">
		{#if cmdMenu.length}
			<div class="cmd-menu">
				{#each cmdMenu as c (c.cmd)}
					<button type="button" class="cmd-row" onclick={() => insertCommand(c.cmd)}>
						<span class="mono key">{c.cmd}</span>
						<span class="hint">{c.hint}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="chips mono">
			{#each commands as c (c.cmd)}
				<button type="button" class="chip" onclick={() => insertCommand(c.cmd)} title={c.hint}>{c.cmd}</button>
			{/each}
		</div>

		<div class="field">
			<textarea
				bind:this={textarea}
				bind:value
				rows="1"
				placeholder="Что ты делаешь?"
				disabled={busy}
				oninput={autosize}
				onkeydown={onKeydown}
				aria-label="Ввод действия"
			></textarea>
			<button type="button" class="send" onclick={submit} disabled={busy || !value.trim()} aria-label="Отправить">
				{busy ? '…' : '➤'}
			</button>
		</div>
	</div>
</div>

<style>
	.composer {
		flex-shrink: 0;
		border-top: 1px solid var(--rule);
		background: var(--surface);
		padding: 12px var(--gutter) max(12px, env(safe-area-inset-bottom));
	}
	.inner {
		max-width: var(--prose-measure);
		margin: 0 auto;
	}

	.cmd-menu {
		border: 1px solid var(--chip-br);
		border-radius: 10px;
		background: var(--bg);
		overflow: hidden;
		margin-bottom: 10px;
	}
	.cmd-row {
		display: flex;
		align-items: baseline;
		gap: 12px;
		width: 100%;
		text-align: left;
		padding: 9px 14px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--rule);
	}
	.cmd-row:last-child {
		border-bottom: none;
	}
	.cmd-row:hover {
		background: var(--chip-bg);
	}
	.cmd-row .key {
		font-size: 0.8rem;
		color: var(--accent);
		width: 62px;
		flex-shrink: 0;
	}
	.cmd-row .hint {
		font-size: 0.85rem;
		color: var(--text-dim);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 10px;
		font-size: 0.7rem;
	}
	.chip {
		padding: 3px 12px;
		border: 1px solid var(--chip-br);
		border-radius: 20px;
		color: var(--accent);
		background: none;
		transition: border-color 0.15s;
	}
	.chip:hover {
		border-color: var(--accent);
	}

	.field {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		border: 1.5px solid var(--accent);
		border-radius: 12px;
		padding: 9px 12px;
		background: var(--bg);
	}
	textarea {
		flex: 1;
		resize: none;
		border: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-prose);
		font-style: italic;
		font-size: 1em;
		line-height: 1.5;
		outline: none;
		max-height: 120px;
	}
	textarea:disabled {
		opacity: 0.6;
	}
	.send {
		width: 36px;
		height: 36px;
		border-radius: 9px;
		background: var(--accent);
		color: var(--on-accent);
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 15px;
		flex-shrink: 0;
		transition: opacity 0.15s;
	}
	.send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
