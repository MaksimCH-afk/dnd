import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from './creation';
import { applyOps } from './apply';
import { npcRecognizesHeroSecret, buildNpcContext, factsKnownBy } from './knowledge';
import type { GameState } from './state';

function withNecromancer(): GameState {
	// Тайный некромант: известность «неизвестен» (renown 0), тайна в scope secret.
	const s = createCharacter({ name: 'Тень', race: 'человек', age_band: 'зрелый', direction: 'академик', darkPath: true, seed: 7 });
	s.character.core.renown = 0;
	// факт-тайна (никто не знает)
	return applyOps(s, [
		{ op: 'fact.add', text: 'герой — некромант', scope: 'secret', known_by: [], tags: ['hero_secret'] }
	], { day: 1 }).state;
}

test('№3: новый трактирщик НЕ опознаёт тайну некроманта', () => {
	let s = withNecromancer();
	// спавним случайного трактирщика
	s = applyOps(s, [
		{ op: 'npc.spawn', seed_card: { id: 'npc_innkeeper', name: 'Тобиас', role: 'трактирщик' } }
	], { day: 1 }).state;

	assert.equal(npcRecognizesHeroSecret(s, 'npc_innkeeper'), false, 'не опознан');
	const ctx = buildNpcContext(s, 'npc_innkeeper')!;
	assert.ok(!ctx.known_facts.some((f) => /некромант/.test(f)), 'тайна не в контексте NPC');
	assert.equal(ctx.recognizes_hero_secret, false);
});

test('№3: после добавления факта в known_by трактирщик опознаёт', () => {
	let s = withNecromancer();
	s = applyOps(s, [{ op: 'npc.spawn', seed_card: { id: 'npc_innkeeper', name: 'Тобиас', role: 'трактирщик' } }], { day: 1 }).state;
	// трактирщик узнал тайну (например, увидел каст)
	s = applyOps(s, [
		{ op: 'fact.add', text: 'герой поднял мертвеца на глазах трактирщика', scope: 'secret', known_by: ['npc_innkeeper'], tags: ['hero_secret'] }
	], { day: 2 }).state;

	assert.equal(npcRecognizesHeroSecret(s, 'npc_innkeeper'), true, 'теперь опознан');
	const ctx = buildNpcContext(s, 'npc_innkeeper')!;
	assert.ok(ctx.known_facts.some((f) => /мертвеца/.test(f)), 'известный факт в контексте');
});

test('№3: public факт виден всем, player-факт — никому из NPC', () => {
	let s = createCharacter({ name: 'А', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 1 });
	s = applyOps(s, [
		{ op: 'npc.spawn', seed_card: { id: 'npc_a', name: 'Гарен' } },
		{ op: 'fact.add', text: 'в городе ярмарка', scope: 'public', known_by: [], tags: [] },
		{ op: 'fact.add', text: 'личная цель героя', scope: 'player', known_by: [], tags: [] }
	], { day: 1 }).state;
	const known = factsKnownBy(s, 'npc_a').map((f) => f.text);
	assert.ok(known.includes('в городе ярмарка'));
	assert.ok(!known.includes('личная цель героя'));
});

test('№4: ядро NPC не дрейфует — меняется только alter_core с причиной', () => {
	let s = createCharacter({ name: 'А', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 1 });
	s = applyOps(s, [
		{ op: 'npc.spawn', seed_card: { id: 'npc_k', name: 'Кеан', race: 'человек', character: 'верный, прямой', motivation: 'защитить сестру', secret: 'дезертир' } }
	], { day: 1 }).state;
	const before = structuredClone(s.npc[0]!.core);

	// alter_core без причины — отклонён, ядро неизменно
	const r1 = applyOps(s, [{ op: 'npc.alter_core', id: 'npc_k', fields: { character: 'предатель' }, cause: '' }], { day: 5 });
	assert.equal(r1.rejected.length, 1);
	assert.deepEqual(r1.state.npc[0]!.core, before, 'без причины ядро не тронуто');

	// alter_core с причиной — меняет и логирует
	const r2 = applyOps(s, [{ op: 'npc.alter_core', id: 'npc_k', fields: { character: 'сломлен, мстителен' }, cause: 'пережил гибель сестры' }], { day: 30 });
	assert.equal(r2.rejected.length, 0);
	assert.equal(r2.state.npc[0]!.core.character, 'сломлен, мстителен');
	assert.equal(r2.state.npc[0]!.core_changes!.length, 1);
	assert.equal(r2.state.npc[0]!.core_changes![0]!.cause, 'пережил гибель сестры');
	// мотивация и секрет не тронуты
	assert.equal(r2.state.npc[0]!.core.motivation, 'защитить сестру');
	assert.equal(r2.state.npc[0]!.core.secret, 'дезертир');
});
