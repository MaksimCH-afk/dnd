<script lang="ts">
	import { settings } from '$lib/settings.svelte';
	import { session } from '$lib/session.svelte';
	import { askApi, type AskEvent } from '$lib/api';

	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let turn = $state(0);
	let events = $state<AskEvent[]>([]);
	let err = $state('');
	let loading = $state(true);

	async function load() {
		loading = true;
		err = '';
		try {
			if (!session.campaignId) {
				err = 'Игра не начата.';
				return;
			}
			const r = await askApi.turn(settings.serverUrl, session.campaignId);
			turn = r.turn;
			events = r.events;
		} catch (e) {
			err = (e as Error).message;
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		void load();
	});

	const ICON: Record<string, string> = {
		input: '⌨',
		mechanics: '🎲',
		context_assembled: '🧩',
		llm_call: '🧠',
		validation: '⚙',
		applied_ops: '±',
		state_diff: '⇄',
		leak_fixed: '🔒',
		leak_detected: '🔒',
		worldsim: '⟳',
		persist: '💾',
		death: '☠',
		error: '✕'
	};

	// Человекочитаемая строка под капотом по типу события.
	function describe(e: AskEvent): string {
		const p = e.payload ?? {};
		switch (e.type) {
			case 'input':
				return `ввод: «${p.input}» (День ${p.day})`;
			case 'mechanics':
				return `механика: ${p.kind ?? 'бросок'}${p.heroHpDelta != null ? `, ΔHP ${p.heroHpDelta}` : ''}${p.ended != null ? `, бой ${p.ended ? 'окончен' : 'идёт'}` : ''}`;
			case 'context_assembled':
				return `контекст: RAG top-${p.retrieved_count ?? 0}, карточек NPC ${(p.npc_cards as unknown[])?.length ?? 0}, модули [${(p.active_modules as string[])?.join(', ') ?? ''}], ~${p.prompt_tokens_est ?? '?'} ток.${p.layer_b ? ', +справка мира' : ''}`;
			case 'llm_call':
				return `модель (${p.role}): ${p.model ?? '—'}${p.usedFallback ? ' [фоллбэк]' : ''}${p.leak != null ? `, утечка: ${p.leak ? 'да' : 'нет'}` : ''}`;
			case 'validation':
				return `проверки: предложено ${p.proposed}, применено ${p.applied}, отклонено ${(p.rejected as unknown[])?.length ?? 0}${(p.rejected as { reason: string }[])?.length ? ` — ${(p.rejected as { reason: string }[]).map((r) => r.reason).join('; ')}` : ''}`;
			case 'applied_ops':
				return `дельты: ${(p.applied as string[])?.join(', ') || '—'}`;
			case 'state_diff': {
				const parts: string[] = [];
				const pair = (k: string, v: unknown) => Array.isArray(v) && parts.push(`${k} ${v[0]}→${v[1]}`);
				pair('капитал', p.capital);
				pair('HP', p.hp);
				pair('выносл.', p.stamina);
				if ((p.items_added as string[])?.length) parts.push(`+предметы: ${(p.items_added as string[]).join(', ')}`);
				if ((p.items_removed as string[])?.length) parts.push(`−предметы: ${(p.items_removed as string[]).join(', ')}`);
				return `изменения: ${parts.join(' · ') || 'нет'}`;
			}
			case 'leak_fixed':
				return `утечка тайны переписана: ${p.reason}`;
			case 'leak_detected':
				return `утечка замечена (не переписана): ${p.reason}`;
			case 'worldsim':
				return `мир-симуляция: ${p.kind === 'tick' ? `тик (День ${p.clock_day}), слухов ${p.rumors}` : `сработало seeds: ${(p.fired as unknown[])?.length ?? 0}`}`;
			case 'persist':
				return `сохранено: схема v${p.schema_version}, День ${p.day}${p.snapshotId ? `, снапшот #${p.snapshotId}` : ''}`;
			case 'death':
				return `гибель героя (HP ${(p.hp as { cur: number })?.cur ?? 0})`;
			case 'error':
				return `ошибка [${p.stage}]: ${p.message}`;
			default:
				return JSON.stringify(p).slice(0, 200);
		}
	}
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="panel mono" role="dialog" aria-label="Спросить мастера (под капот)" aria-modal="true">
	<header>
		<div>
			<h2>/ask · под капот</h2>
			<small>ход {turn || '—'} · детерминированный лог движка (вне мира)</small>
		</div>
		<button class="close" onclick={onclose} aria-label="Закрыть">✕</button>
	</header>

	{#if loading}
		<p class="hint">Читаю лог хода…</p>
	{:else if err}
		<p class="err">✕ {err}</p>
	{:else if events.length === 0}
		<p class="hint">Для этого хода нет записей лога (сделай ход и спроси снова).</p>
	{:else}
		<ul class="events">
			{#each events as e (e.seq)}
				<li class:warn={e.level === 'warn'} class:error={e.level === 'error'}>
					<span class="ico">{ICON[e.type] ?? '·'}</span>
					<span class="line">{describe(e)}</span>
				</li>
			{/each}
		</ul>
	{/if}
	<button class="reload" onclick={load} disabled={loading}>↻ Обновить</button>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 12; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(94vw, 600px); max-height: 86vh; overflow-y: auto; background: var(--surface-raised, var(--surface)); border: 1px solid var(--accent); border-radius: var(--radius); padding: 1rem 1.2rem 1.2rem; z-index: 13; box-shadow: 0 20px 60px rgba(0,0,0,.6); font-size: .8rem; }
	header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: .7rem; border-bottom: 1px dashed var(--border); padding-bottom: .5rem; }
	header h2 { margin: 0; font-size: .95rem; color: var(--accent); }
	header small { color: var(--text-dim); font-size: .72em; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1rem; }
	.hint { color: var(--text-dim); }
	.err { color: var(--danger); }
	.events { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .3rem; }
	.events li { display: flex; gap: .5rem; align-items: baseline; padding: .25rem .35rem; border-left: 2px solid var(--border); }
	.events li.warn { border-left-color: var(--warm, orange); }
	.events li.error { border-left-color: var(--danger); }
	.ico { flex-shrink: 0; width: 1.3em; text-align: center; }
	.line { overflow-wrap: anywhere; line-height: 1.45; color: var(--text); }
	.reload { margin-top: .8rem; background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 6px; padding: .3rem .7rem; font-size: .9em; }
</style>
