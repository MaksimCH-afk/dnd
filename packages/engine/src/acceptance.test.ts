/**
 * Прогон критериев приёмки (ТЗ §16) — детерминированные пункты. Сетевые/UI-пункты
 * (кросс-девайс, тёмный контент) проверяются вручную.
 * Русский recall эмбеддера (№2, §10/§21) — отдельным скриптом на сервере:
 * `pnpm --filter @rpg/server recall` (apps/server/scripts/recall-check.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from './creation';
import { applyOps } from './apply';
import { migrate } from './migrate';
import { pickNextArc, beginArc } from './director';
import { npcRecognizesHeroSecret } from './knowledge';
import { priceFor } from './economy';
import { resolveAttack, computeAC } from './combat';
import { makeRng } from './rng';
import type { GameState, Op } from './index';

function saveLoad(state: GameState): GameState {
	// /save (JSON-экспорт) → /go (загрузка + миграция), как на другом устройстве.
	return migrate(JSON.parse(JSON.stringify(state))).state;
}

test('§16.1 — инвентарь: 15+ предметов, 10 циклов save+go → набор и заряды идентичны', () => {
	let s = createCharacter({ name: 'Тест', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 1 });
	const adds: Op[] = Array.from({ length: 16 }, (_, i) => ({
		op: 'item.add',
		item: { name: `Предмет ${i}`, qty: 1 + (i % 3), magical: i % 4 === 0, ...(i % 4 === 0 ? { charges: 5 } : {}) }
	}));
	s = applyOps(s, adds, { day: 1 }).state;
	const baseline = JSON.stringify(s.inventory.items);

	for (let cycle = 0; cycle < 10; cycle++) s = saveLoad(s);
	assert.equal(JSON.stringify(s.inventory.items), baseline, 'инвентарь и заряды не дрейфуют за 10 циклов');
	assert.ok(s.inventory.items.length >= 15);
});

test('§16.2/3 — scope знания: тайна не утекает, узнаётся через known_by', () => {
	let s = createCharacter({ name: 'Тень', race: 'человек', age_band: 'зрелый', direction: 'академик', darkPath: true, seed: 7 });
	s.character.core.renown = 0;
	s = applyOps(s, [
		{ op: 'npc.spawn', seed_card: { id: 'npc_inn', name: 'Тобиас', role: 'трактирщик' } },
		{ op: 'fact.add', text: 'герой — некромант', scope: 'secret', known_by: [], tags: ['hero_secret'] }
	], { day: 1 }).state;
	s = saveLoad(s);
	assert.equal(npcRecognizesHeroSecret(s, 'npc_inn'), false);

	s = applyOps(s, [{ op: 'fact.add', text: 'видел каст', scope: 'secret', known_by: ['npc_inn'], tags: ['hero_secret'] }], { day: 2 }).state;
	assert.equal(npcRecognizesHeroSecret(s, 'npc_inn'), true);
});

test('§16.3(№4) — идентичность NPC не дрейфует за 300+ дней; только alter_core с причиной', () => {
	let s = createCharacter({ name: 'А', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 2 });
	s = applyOps(s, [{ op: 'npc.spawn', seed_card: { id: 'npc_k', name: 'Кеан', character: 'верный', motivation: 'защита сестры', secret: 'дезертир' } }], { day: 1 }).state;
	const core0 = JSON.stringify(s.npc[0]!.core);
	// «прогон 300 дней» — много циклов save/load и попыток сменить ядро без причины
	for (let d = 1; d <= 300; d += 30) {
		s = saveLoad(s);
		const r = applyOps(s, [{ op: 'npc.alter_core', id: 'npc_k', fields: { character: 'злодей' }, cause: '' }], { day: d });
		assert.equal(r.rejected.length, 1);
		s = r.state;
	}
	assert.equal(JSON.stringify(s.npc[0]!.core), core0, 'ядро не дрейфовало');
});

test('§16.5(№1) — анти-повтор: 20 арок, доля повторов ниже порога', () => {
	const s = createCharacter({ name: 'Б', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 3 });
	const rng = makeRng(999);
	const keys: string[] = [];
	for (let i = 0; i < 20; i++) {
		const a = pickNextArc(s.arcs, rng);
		keys.push(a.key);
		beginArc(s, a);
	}
	assert.ok(new Set(keys).size / keys.length >= 0.9);
});

test('§16.6(R1) — воин и шпион без магии; боевой маг показывает оба модуля', () => {
	const warrior = createCharacter({ name: 'В', race: 'человек', age_band: 'зрелый', direction: 'военный', seed: 4 });
	const spy = createCharacter({ name: 'Ш', race: 'человек', age_band: 'зрелый', direction: 'преступник', seed: 5 });
	assert.equal(warrior.character.modules.magic, undefined);
	assert.equal(spy.character.modules.magic, undefined);
	assert.ok(spy.character.modules.intrigue);
});

test('§16.9(R2) — кости и цены приходят от движка, воспроизводимы', () => {
	const ac = computeAC({ dex: 12, armor: 2, style: 'обычный' });
	const r1 = resolveAttack({ attackBonus: 3, style: 'обычный', targetAC: ac }, makeRng(11));
	const r2 = resolveAttack({ attackBonus: 3, style: 'обычный', targetAC: ac }, makeRng(11));
	assert.deepEqual(r1, r2);
	const p1 = priceFor('длинный меч', { region: 'столица' }, makeRng(22));
	const p2 = priceFor('длинный меч', { region: 'столица' }, makeRng(22));
	assert.equal(p1.mp, p2.mp);
});

test('§15 — миграция: старый/битый сейв чинится и идемпотентен', () => {
	const partial = { schema_version: 0, character: { core: { name: 'X', race: 'человек', age: 30, directions: ['наёмник'], attrs: { STR: 10, DEX: 10, CON: 10, INT: 10, PER: 10, CHA: 10 }, hp: { cur: 50, max: 50 }, stamina: { cur: 100, max: 100 }, updated_day: 1 } } };
	const m = migrate(partial);
	assert.equal(m.changed, true);
	assert.equal(m.state.schema_version, 1);
	assert.ok(Array.isArray(m.state.facts) && Array.isArray(m.state.seeds));
	assert.ok(Array.isArray(m.state.inventory.items));
	// идемпотентность
	const again = migrate(m.state);
	assert.equal(again.changed, false);
	assert.deepEqual(again.state, m.state);
});
