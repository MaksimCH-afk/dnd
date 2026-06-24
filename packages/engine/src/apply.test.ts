import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from './apply';
import { SCHEMA_VERSION, type GameState } from './state';
import type { Op } from './ops';

function initialState(): GameState {
	return {
		schema_version: SCHEMA_VERSION,
		character: {
			core: {
				name: 'Тест',
				race: 'человек',
				age: 30,
				directions: ['наёмник'],
				attrs: { STR: 12, DEX: 12, CON: 12, INT: 10, PER: 10, CHA: 10 },
				hp: { cur: 60, max: 60 },
				stamina: { cur: 120, max: 120 },
				statuses: [],
				features: [],
				specializations: [],
				reputation: [],
				renown: 0,
				updated_day: 1
			},
			modules: { combat_mastery: { weapons: ['меч'], features: [], hidden_level: 1 } }
		},
		inventory: { items: [], capital_mp: 5000, journal: [] },
		facts: [],
		npc: [],
		relationships: [],
		contracts: [],
		locations: [],
		timers: [],
		chronicle: [],
		seeds: [],
		arcs: [],
		session: {
			day: 1,
			time_of_day: 'утро',
			season: 'весна',
			current_moment: 'старт',
			npcs_in_scene: [],
			open_threads: []
		}
	};
}

const ctx = { day: 1 };

test('№5: 15+ предметов переживают сериализацию save/load без потерь', () => {
	let state = initialState();
	const adds: Op[] = Array.from({ length: 15 }, (_, i) => ({
		op: 'item.add',
		item: {
			name: `Предмет ${i}`,
			qty: i === 0 ? 3 : 1,
			magical: i % 5 === 0,
			...(i % 5 === 0 ? { charges: 3 } : {})
		}
	}));
	const r = applyOps(state, adds, ctx);
	assert.equal(r.rejected.length, 0, 'все добавления валидны');
	assert.equal(r.state.inventory.items.length, 15);
	state = r.state;

	// Симуляция save → load (JSON round-trip) на «разных устройствах».
	const reloaded = JSON.parse(JSON.stringify(state)) as GameState;
	assert.deepEqual(reloaded.inventory.items, state.inventory.items, 'инвентарь идентичен после save/load');

	// Артефакты с зарядами сохранили заряды.
	const magical = reloaded.inventory.items.filter((i) => i.magical);
	assert.ok(magical.length >= 3);
	assert.ok(magical.every((i) => i.charges === 3), 'заряды артефактов сохранены');
});

test('№5: дельта-операции, инвентарь не пересобирается', () => {
	let state = initialState();
	state = applyOps(state, [
		{ op: 'item.add', item: { name: 'Зелье', qty: 5 } },
		{ op: 'item.add', item: { name: 'Жезл', qty: 1, magical: true, charges: 10 } }
	], ctx).state;

	const potionId = state.inventory.items.find((i) => i.name === 'Зелье')!.id;
	const wandId = state.inventory.items.find((i) => i.name === 'Жезл')!.id;

	// Частичное снятие, трата зарядов, полное снятие.
	const r = applyOps(state, [
		{ op: 'item.remove', id: potionId, qty: 2, reason: 'выпил' },
		{ op: 'item.update', id: wandId, fields: { charges: 7 } },
		{ op: 'capital.change', delta: -1200, reason: 'покупка' }
	], ctx);
	assert.equal(r.rejected.length, 0);
	state = r.state;

	assert.equal(state.inventory.items.find((i) => i.id === potionId)!.qty, 3);
	assert.equal(state.inventory.items.find((i) => i.id === wandId)!.charges, 7);
	assert.equal(state.inventory.capital_mp, 3800);
	assert.equal(state.inventory.journal.at(-1)!.delta, -1200);
});

test('№5: невалидные операции отклоняются, состояние не теряет предметы', () => {
	let state = initialState();
	state = applyOps(state, [{ op: 'item.add', item: { name: 'Меч', qty: 1 } }], ctx).state;
	const before = JSON.stringify(state.inventory);

	const r = applyOps(state, [
		{ op: 'item.remove', id: 'нет-такого', qty: 1, reason: 'x' },
		{ op: 'item.remove', id: state.inventory.items[0]!.id, qty: 99, reason: 'слишком много' },
		{ op: 'capital.change', delta: -999999, reason: 'минус' }
	], ctx);

	assert.equal(r.applied.length, 0);
	assert.equal(r.rejected.length, 3);
	assert.equal(JSON.stringify(r.state.inventory), before, 'инвентарь/капитал не изменились');
});

test('гейтинг модулей: операции без активного модуля отклоняются', () => {
	const state = initialState(); // только combat_mastery
	const r = applyOps(state, [
		{ op: 'power.set', state: 'Истощён' }, // нужен magic
		{ op: 'heat.change', delta: 1, reason: 'засветился' }, // нужен intrigue
		{ op: 'faith.shift', delta: -1, reason: 'грех' } // нужен faith
	], ctx);
	assert.equal(r.applied.length, 0);
	assert.equal(r.rejected.length, 3);
	assert.ok(r.rejected.every((x) => /не активен/.test(x.reason)));
});

test('исходное состояние не мутируется (чистая транзакция)', () => {
	const state = initialState();
	const snapshot = JSON.stringify(state);
	applyOps(state, [{ op: 'item.add', item: { name: 'X', qty: 1 } }], ctx);
	assert.equal(JSON.stringify(state), snapshot, 'prev не тронут');
});
