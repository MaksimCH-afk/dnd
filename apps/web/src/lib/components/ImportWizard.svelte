<script lang="ts">
	import { importCampaign } from '$lib/session.svelte';

	interface Props {
		oncancel: () => void;
		onimported: () => void;
	}
	let { oncancel, onimported }: Props = $props();

	let character = $state('');
	let inventory = $state('');
	let npcs = $state('');
	let sessionDoc = $state('');
	let busy = $state(false);
	let error = $state('');

	const slots: { key: 'character' | 'inventory' | 'npcs' | 'session'; label: string; hint: string }[] = [
		{ key: 'character', label: 'Лист персонажа', hint: 'имя, раса, возраст, направление, особенности' },
		{ key: 'inventory', label: 'Инвентарь', hint: 'предметы, экипировка, деньги' },
		{ key: 'npcs', label: 'NPC', hint: 'значимые лица: кто, роль, мотивы' },
		{ key: 'session', label: 'Описание сессии', hint: 'где герой сейчас, что происходит, предыстория' }
	];
	function val(key: string): string {
		return key === 'character' ? character : key === 'inventory' ? inventory : key === 'npcs' ? npcs : sessionDoc;
	}
	function setVal(key: string, v: string) {
		if (key === 'character') character = v;
		else if (key === 'inventory') inventory = v;
		else if (key === 'npcs') npcs = v;
		else sessionDoc = v;
	}

	async function onFile(key: string, e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		setVal(key, await f.text());
	}

	const canSubmit = $derived(Boolean(character.trim() || inventory.trim() || npcs.trim() || sessionDoc.trim()));

	async function submit() {
		if (!canSubmit || busy) return;
		busy = true;
		error = '';
		try {
			const warnings = await importCampaign({ character, inventory, npcs, session: sessionDoc });
			if (warnings.length) {
				// показываем, но не блокируем — партия уже создана
				console.warn('import warnings', warnings);
			}
			onimported();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="backdrop" onclick={oncancel} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Импорт игры" aria-modal="true">
	<header>
		<h2>Импорт игры из документов</h2>
		<button class="close" onclick={oncancel} aria-label="Закрыть">✕</button>
	</header>

	<p class="lead">
		Вставь или загрузи свои документы — сервер соберёт из них персонажа, инвентарь,
		лица и текущую сцену, и партия продолжится. Достаточно хотя бы одного документа.
	</p>

	<div class="slots">
		{#each slots as s (s.key)}
			<div class="slot">
				<div class="slot-head">
					<span class="slot-label">{s.label}</span>
					<label class="file mono">
						файл…
						<input type="file" accept=".md,.txt,text/*" onchange={(e) => onFile(s.key, e)} hidden />
					</label>
				</div>
				<textarea
					rows="4"
					placeholder={s.hint}
					value={val(s.key)}
					oninput={(e) => setVal(s.key, (e.currentTarget as HTMLTextAreaElement).value)}
				></textarea>
			</div>
		{/each}
	</div>

	{#if error}<p class="err mono">✕ {error}</p>{/if}

	<div class="actions">
		<button class="ghost" onclick={oncancel}>Отмена</button>
		<button class="primary" onclick={submit} disabled={!canSubmit || busy}>
			{busy ? 'Собираю партию…' : 'Импортировать и продолжить'}
		</button>
	</div>
	<small class="note">Разбор делает модель Ведущего — это один платный/бесплатный вызов. Точные числа потом честно ведёт движок.</small>
</div>

<style>
	.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 12; }
	.panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(94vw, 600px); max-height: 90vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.2rem 1.4rem 1.4rem; z-index: 13; box-shadow: 0 24px 70px rgba(0,0,0,.6); }
	header { display: flex; justify-content: space-between; align-items: center; margin-bottom: .6rem; }
	header h2 { margin: 0; font-size: 1.2rem; }
	.close { background: none; border: none; color: var(--text-dim); font-size: 1.1rem; }
	.lead { font-size: .9em; color: var(--text-dim); line-height: 1.5; margin: 0 0 1rem; }
	.slots { display: flex; flex-direction: column; gap: .9rem; }
	.slot-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .3rem; }
	.slot-label { font-family: var(--font-display); font-size: .92rem; color: var(--warm); }
	.file { font-size: .72rem; color: var(--accent); cursor: pointer; border: 1px solid var(--chip-br); border-radius: 14px; padding: .1rem .6rem; }
	textarea { width: 100%; resize: vertical; background: var(--field, var(--surface-raised)); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: .5rem .7rem; font: inherit; font-size: .9em; line-height: 1.45; }
	.err { color: var(--danger); font-size: .85em; }
	.actions { display: flex; justify-content: flex-end; gap: .6rem; margin-top: 1rem; }
	.ghost { background: var(--surface-raised); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: .55rem 1rem; }
	.primary { background: var(--accent); color: var(--on-accent); border: none; border-radius: 8px; padding: .55rem 1.2rem; }
	.primary:disabled { opacity: .5; cursor: not-allowed; }
	.note { display: block; margin-top: .7rem; font-size: .74em; color: var(--text-dim); line-height: 1.4; }
</style>
