<script lang="ts">
	import type { GameState, InventoryItem } from '@rpg/engine';
	import { statusFields, formatMoney } from '$lib/status';

	interface Props {
		state: GameState;
		/** id предметов, изменённых последним ходом (для подсветки дельт). */
		highlight?: Set<string>;
	}
	let { state, highlight }: Props = $props();

	const core = $derived(state.character.core);
	const mods = $derived(state.character.modules);
	const fields = $derived(statusFields(state));

	const slots: { key: InventoryItem['slot']; title: string }[] = [
		{ key: 'надето', title: 'Надето' },
		{ key: 'сумка', title: 'В сумке' },
		{ key: 'схрон', title: 'В схроне' }
	];
	function bySlot(slot: InventoryItem['slot']): InventoryItem[] {
		return state.inventory.items.filter((i) => i.slot === slot);
	}
</script>

<div class="ledger-body">
	<!-- Герой -->
	<section>
		<h3>{core.name}</h3>
		<p class="sub mono">{core.race}, {core.age} · {core.directions.join(', ')}</p>
		<div class="status">
			{#each fields as f (f.label)}
				<div class="stat">
					<span class="k">{f.label}</span>
					<span class="v" class:mono={f.mono}>{f.value}</span>
				</div>
			{/each}
		</div>
		{#if core.statuses.length}
			<ul class="tags warn">
				{#each core.statuses as s (s.effect)}<li>{s.effect}</li>{/each}
			</ul>
		{/if}
		{#if core.features.length}
			<ul class="tags">
				{#each core.features as f (f)}<li>{f}</li>{/each}
			</ul>
		{/if}
	</section>

	<!-- Активные модули (адаптивно) -->
	{#if mods.magic}
		<section>
			<h4>Магия</h4>
			<p class="line">Сила: <b>{mods.magic.power}</b> · {mods.magic.mage_type}</p>
			{#each mods.magic.schools as s (s.school)}
				<p class="line">{s.school} — {s.mastery}</p>
			{/each}
			{#each mods.magic.dark_arcs as a (a.arc)}
				<p class="line dark">{a.note}</p>
			{/each}
		</section>
	{/if}
	{#if mods.combat_mastery}
		<section>
			<h4>Бой</h4>
			<p class="line">{mods.combat_mastery.weapons.join(', ')}</p>
			{#each mods.combat_mastery.features as f (f)}<p class="line">{f}</p>{/each}
		</section>
	{/if}
	{#if mods.intrigue}
		<section>
			<h4>Интрига</h4>
			<p class="line">Прикрытия: {mods.intrigue.covers.join(', ') || '—'}</p>
			<p class="line">Схроны: {mods.intrigue.caches.length}</p>
		</section>
	{/if}
	{#if mods.faith}
		<section>
			<h4>Вера</h4>
			<p class="line">{mods.faith.deity} · {mods.faith.domain}</p>
			<p class="line">{mods.faith.cult_status}</p>
		</section>
	{/if}
	{#if mods.craft}
		<section>
			<h4>Ремесло</h4>
			<p class="line">{mods.craft.craft} — {mods.craft.level}</p>
			<p class="line">{mods.craft.guild_status}</p>
		</section>
	{/if}
	{#if mods.influence}
		<section>
			<h4>Влияние</h4>
			<p class="line">{mods.influence.titles.join(', ') || '—'}</p>
			<p class="line">{mods.influence.court_status}</p>
		</section>
	{/if}

	<!-- Инвентарь -->
	<section>
		<h4>Инвентарь</h4>
		{#each slots as slot (slot.key)}
			{@const items = bySlot(slot.key)}
			{#if items.length}
				<p class="slot-title mono">{slot.title}</p>
				<ul class="items">
					{#each items as it (it.id)}
						<li class:hl={highlight?.has(it.id)} class:magical={it.magical}>
							<span class="name">{it.name}</span>
							<span class="qty mono">
								{#if it.qty > 1}×{it.qty}{/if}
								{#if it.charges != null}⚡{it.charges}{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{/each}
	</section>

	<!-- Бой (если идёт) -->
	{#if state.combat}
		<section class="combat">
			<h4>⚔ Бой · обмен {state.combat.round}</h4>
			<ul class="enemies">
				{#each state.combat.enemies as e (e.id)}
					<li class:down={e.hp_cur <= 0} class:fled={e.fled}>
						<span class="ename">{e.name}</span>
						<span class="ehp mono">{e.fled ? 'бежал' : e.hp_cur <= 0 ? 'повержен' : `${e.hp_cur}/${e.hp_max}`}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- NPC (значимые/в сцене) -->
	{#if state.npc.length}
		<section>
			<h4>Лица</h4>
			<ul class="npcs">
				{#each state.npc as n (n.id)}
					<li class:scene={state.session.npcs_in_scene.includes(n.id)}>
						<div class="npc-head">
							<b>{n.core.name}</b>
							<span class="npc-mood">{n.living.mood}</span>
						</div>
						<span class="npc-sub mono">{n.core.race}, {n.core.role}</span>
						{#if n.core_changes?.length}
							<span class="npc-sub dim">⟳ изменён ({n.core_changes.at(-1)!.cause})</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Контракты -->
	{#if state.contracts.length}
		<section>
			<h4>Контракты</h4>
			<ul class="contracts">
				{#each state.contracts as c (c.id)}
					<li>
						<span class="ctitle">{c.title}</span>
						<span class="cstatus mono">{c.status}{c.deadline_day ? ` · День ${c.deadline_day}` : ''}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Таймеры -->
	{#if state.timers.length}
		<section>
			<h4>Таймеры</h4>
			<ul class="timers mono">
				{#each state.timers as t (t.id)}
					<li>{t.label} — День {t.due_day}</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Арка / отложенные последствия -->
	{#if state.arcs.length || state.seeds.length}
		<section>
			<h4>Сюжет</h4>
			{#if state.arcs.length}
				{@const arc = state.arcs[state.arcs.length - 1]}
				<p class="line">Арка: {arc.tags.slice(0, 3).join(' · ')}</p>
			{/if}
			{#if state.seeds.length}
				<p class="line dim">Отложенных нитей: {state.seeds.length}</p>
			{/if}
		</section>
	{/if}

	<!-- Капитал -->
	<section>
		<h4>Капитал</h4>
		<p class="capital mono">{formatMoney(state.inventory.capital_mp)}</p>
		{#if state.inventory.journal.length}
			<ul class="journal mono">
				{#each state.inventory.journal.slice(-4).reverse() as j (j.day + j.reason + j.delta)}
					<li>
						<span class:plus={j.delta > 0} class:minus={j.delta < 0}>
							{j.delta > 0 ? '+' : ''}{formatMoney(Math.abs(j.delta))}
						</span>
						<span class="reason">{j.reason}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.ledger-body {
		display: flex;
		flex-direction: column;
		gap: 1.3rem;
	}
	section h3 {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 600;
		color: var(--text);
	}
	section h4 {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: var(--warm);
		border-bottom: 1px solid var(--rule);
		padding-bottom: 0.4rem;
	}
	.sub {
		color: var(--text-dim);
		font-size: 0.78em;
		margin: 0.2rem 0 0.7rem;
	}
	.status {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
	}
	.stat .k {
		font-size: 0.68em;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.stat .v {
		font-size: 0.95em;
	}
	.tags {
		list-style: none;
		padding: 0;
		margin: 0.7rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.tags li {
		font-size: 0.74em;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}
	.tags.warn li {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}
	.line {
		margin: 0.2rem 0;
		font-size: 0.86em;
	}
	.line.dark {
		color: var(--danger);
		font-style: italic;
	}
	.line.dim {
		color: var(--text-dim);
		opacity: 0.8;
	}
	.slot-title {
		font-size: 0.7em;
		color: var(--text-dim);
		margin: 0.6rem 0 0.2rem;
	}
	.items {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.items li {
		display: flex;
		justify-content: space-between;
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		font-size: 0.88em;
		transition: background 0.4s;
	}
	.items li.magical .name {
		color: var(--moon-300);
	}
	.items li.hl {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.items .qty {
		color: var(--text-dim);
		font-size: 0.85em;
	}
	.combat h4 {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}
	.enemies {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.enemies li {
		display: flex;
		justify-content: space-between;
		padding: 0.2rem 0;
		font-size: 0.85em;
	}
	.enemies li.down,
	.enemies li.fled {
		opacity: 0.5;
		text-decoration: line-through;
	}
	.enemies .ehp {
		color: var(--text-dim);
		font-size: 0.85em;
	}
	.npcs {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.npcs li {
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		background: var(--ink-900);
		border: 1px solid var(--border);
	}
	.npcs li.scene {
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.npc-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.npc-mood {
		font-size: 0.72em;
		color: var(--text-dim);
	}
	.npc-sub {
		display: block;
		font-size: 0.72em;
		color: var(--text-dim);
	}
	.npc-sub.dim {
		opacity: 0.7;
		font-style: italic;
	}
	.contracts,
	.timers {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.contracts li {
		display: flex;
		flex-direction: column;
		padding: 0.25rem 0;
		font-size: 0.85em;
	}
	.contracts .cstatus {
		font-size: 0.72em;
		color: var(--text-dim);
	}
	.timers li {
		font-size: 0.76em;
		color: var(--text-dim);
		padding: 0.1rem 0;
	}
	.capital {
		font-size: 1.05em;
		color: var(--vellum-100);
		margin: 0 0 0.5rem;
	}
	.journal {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.76em;
	}
	.journal li {
		display: flex;
		gap: 0.5rem;
		color: var(--text-dim);
		padding: 0.1rem 0;
	}
	.journal .plus {
		color: var(--accent);
	}
	.journal .minus {
		color: var(--danger);
	}
	.journal .reason {
		opacity: 0.8;
	}
</style>
