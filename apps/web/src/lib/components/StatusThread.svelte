<script lang="ts">
	/**
	 * «Нить состояния» (ТЗ 18.3) — сигнатурная тонкая светящаяся линия в gutter
	 * между прозой и гроссбухом. Кодирует главный ресурс-риск сборки персонажа.
	 *
	 * ФАЗА 0: персонажа/состояния ещё нет — нить в нейтральном «холостом» режиме.
	 * В фазе 1+ интенсивность/цвет завязываются на Силу / выносливость / heat / веру.
	 */
	interface Props {
		/** 0..1 — общая «активность» нити (для idle малая). */
		intensity?: number;
		/** Пульсирует ли (например, рядом Место Силы). */
		pulse?: boolean;
		/** Тон: обычный акцент или тревога (раны/истощение/высокий след). */
		tone?: 'accent' | 'danger';
	}
	let { intensity = 0.25, pulse = false, tone = 'accent' }: Props = $props();
</script>

<div class="thread" class:pulse class:danger={tone === 'danger'} style="--i: {intensity}" aria-hidden="true">
	<div class="line"></div>
</div>

<style>
	.thread {
		width: 3px;
		align-self: stretch;
		display: flex;
		justify-content: center;
		background: transparent;
	}
	.thread {
		--thread-color: var(--accent);
	}
	.thread.danger {
		--thread-color: var(--danger);
	}
	.line {
		width: 1px;
		height: 100%;
		background: linear-gradient(
			to bottom,
			transparent,
			color-mix(in srgb, var(--thread-color) calc(var(--i) * 100%), transparent),
			transparent
		);
		box-shadow: 0 0 calc(6px * var(--i)) color-mix(in srgb, var(--thread-color) 60%, transparent);
		transition: background 0.6s ease, box-shadow 0.6s ease;
	}
	.pulse .line {
		animation: pulse 3.5s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}
</style>
