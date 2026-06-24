import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from './creation';
import { applyOps } from './apply';
import { startEncounter, resolveExchange } from './encounter';
import { makeRng } from './rng';

test('бой: combat.start создаёт стычку, combat.end очищает', () => {
	let s = createCharacter({ name: 'Воин', race: 'человек', age_band: 'зрелый', direction: 'военный', seed: 1 });
	s = applyOps(s, [{ op: 'combat.start', enemies: [{ name: 'Гоблин', tier: 'слабый' }, { name: 'Бандит', tier: 'обычный' }] }], { day: 1 }).state;
	assert.ok(s.combat);
	assert.equal(s.combat!.enemies.length, 2);
	assert.ok(s.combat!.enemies.every((e) => e.hp_cur > 0));
	s = applyOps(s, [{ op: 'combat.end' }], { day: 1 }).state;
	assert.equal(s.combat, undefined);
});

test('бой: обмен наносит урон и завершается победой/поражением; детерминизм', () => {
	const s = createCharacter({ name: 'Воин', race: 'человек', age_band: 'зрелый', direction: 'военный', seed: 2 });
	const enc = startEncounter([{ name: 'Крыса', tier: 'слабый', weapon: 'кинжал' }], makeRng(3));

	const a = resolveExchange(s, enc, { style: 'обычный' }, makeRng(10));
	const b = resolveExchange(s, enc, { style: 'обычный' }, makeRng(10));
	assert.deepEqual(a.cues, b.cues, 'один сид → один исход');
	assert.ok(a.cues.length > 0);

	// добиваем крысу серией обменов
	let e = enc;
	let killed = false;
	for (let i = 0; i < 20 && !killed; i++) {
		const r = resolveExchange(s, e, { style: 'агрессивный' }, makeRng(100 + i));
		e = r.encounter;
		if (r.victory) killed = true;
	}
	assert.ok(killed, 'слабого врага можно одолеть');
});

test('бой: бегство возможно и завершает стычку', () => {
	const s = createCharacter({ name: 'Вор', race: 'человек', age_band: 'зрелый', direction: 'преступник', seed: 4 });
	const enc = startEncounter([{ name: 'Стражник', tier: 'обычный' }], makeRng(5));
	let fled = false;
	for (let i = 0; i < 30 && !fled; i++) {
		const r = resolveExchange(s, enc, { style: 'только защита', flee: true }, makeRng(200 + i));
		if (r.ended && !r.victory && !r.heroDown) fled = true;
	}
	assert.ok(fled, 'рано или поздно удаётся сбежать');
});
