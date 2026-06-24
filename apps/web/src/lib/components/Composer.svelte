<script lang="ts">
	interface Props {
		busy: boolean;
		onsend: (text: string) => void;
	}
	let { busy, onsend }: Props = $props();

	let value = $state('');
	let textarea: HTMLTextAreaElement | undefined = $state();

	const commands = [
		{ label: '/go', title: 'Продолжить' },
		{ label: '/save', title: 'Сохранить' },
		{ label: '/ask', title: 'Спросить мастера' }
	];

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
		value = value.trim().length ? `${cmd} ${value.trim()}` : `${cmd} `;
		textarea?.focus();
		autosize();
	}

	function autosize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
	}
</script>

<div class="composer">
	<div class="chips">
		{#each commands as cmd (cmd.label)}
			<button type="button" class="chip mono" onclick={() => insertCommand(cmd.label)} title={cmd.title}>
				{cmd.label}
			</button>
		{/each}
	</div>
	<div class="row">
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

<style>
	.composer {
		border-top: 1px solid var(--border);
		background: color-mix(in srgb, var(--surface) 70%, transparent);
		backdrop-filter: blur(8px);
		padding: 0.6rem var(--gutter) max(0.6rem, env(safe-area-inset-bottom));
	}
	.chips {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}
	.chip {
		background: var(--surface-raised);
		border: 1px solid var(--border);
		color: var(--text-dim);
		border-radius: 999px;
		padding: 0.2rem 0.7rem;
		font-size: 0.85em;
		transition: color 0.15s, border-color 0.15s;
	}
	.chip:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.row {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}
	textarea {
		flex: 1;
		resize: none;
		background: var(--surface-raised);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem 0.8rem;
		font-family: var(--font-prose);
		font-size: 1em;
		line-height: 1.5;
		max-height: 240px;
	}
	textarea:disabled {
		opacity: 0.6;
	}
	.send {
		background: var(--accent);
		color: var(--ink-900);
		border: none;
		border-radius: var(--radius);
		width: 3rem;
		height: 2.7rem;
		font-size: 1.1rem;
		flex-shrink: 0;
		transition: opacity 0.15s;
	}
	.send:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
