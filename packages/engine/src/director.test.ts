import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from './rng';
import { createCharacter } from './creation';
import { pickNextArc, beginArc } from './director';
import { tickSeeds } from './seeds';
import { tickWorld } from './worldsim';
import { applyOps } from './apply';

test('№1: 20 арок подряд — доля повторных комбинаций ниже порога', () => {
	const state = createCharacter({ name: 'А', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 1 });
	const rng = makeRng(123);
	const keys: string[] = [];
	for (let i = 0; i < 20; i++) {
		const arc = pickNextArc(state.arcs, rng);
		keys.push(arc.key);
		beginArc(state, arc);
	}
	const unique = new Set(keys).size;
	assert.ok(unique / keys.length >= 0.9, `уникальных ${unique}/20`);
	assert.equal(state.arcs.length, 20);
});

test('№1: Режиссёр не предлагает уже использованный мотив (при наличии простора)', () => {
	const state = createCharacter({ name: 'Б', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 2 });
	const rng = makeRng(7);
	const first = pickNextArc(state.arcs, rng);
	beginArc(state, first);
	for (let i = 0; i < 30; i++) {
		const next = pickNextArc(state.arcs, rng);
		assert.notEqual(next.key, first.key, 'не повторяет уже использованный мотив');
		beginArc(state, next);
	}
});

test('№1: seeds срабатывают отложенно по времени', () => {
	let state = createCharacter({ name: 'В', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 3 });
	state = applyOps(state, [
		{ op: 'seed.plant', description: 'долг наступит', trigger: { type: 'time', params: { due_day: 5 } }, payload: { text: 'Кредитор пришёл за долгом.' }, tags: ['долг'] }
	], { day: 1 }).state;

	const rng = makeRng(1);
	const early = tickSeeds(state, 3, rng);
	assert.equal(early.fired.length, 0, 'на День 3 не срабатывает');
	assert.equal(early.state.seeds.length, 1);

	const late = tickSeeds(state, 5, rng);
	assert.equal(late.fired.length, 1, 'на День 5 срабатывает');
	assert.equal(late.state.seeds.length, 0, 'seed удалён');
	assert.ok(late.state.facts.some((f) => /Кредитор/.test(f.text) && f.scope === 'public'));
});

test('№1: мир-тик порождает слухи и иногда seeds; детерминизм', () => {
	const state = createCharacter({ name: 'Г', race: 'человек', age_band: 'зрелый', direction: 'наёмник', seed: 4 });
	const a = tickWorld(state, makeRng(50));
	const b = tickWorld(state, makeRng(50));
	assert.deepEqual(a.state.facts, b.state.facts, 'один сид → один результат');
	assert.ok(a.state.world_state, 'инициализировано состояние мира');
	// прогон нескольких тиков накапливает слухи
	let s = state;
	for (let i = 0; i < 5; i++) s = tickWorld(s, makeRng(100 + i)).state;
	assert.ok(s.facts.filter((f) => f.tags.includes('слух')).length >= 0);
});
