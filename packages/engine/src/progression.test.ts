import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter } from './creation';
import { applyOps } from './apply';
import type { Op } from './ops';

test('B6: счётчик практики боя выдаёт особенность на пороге (combat=6)', () => {
	let s = createCharacter({ name: 'Воин', race: 'человек', age_band: 'зрелый', direction: 'военный', seed: 1 });
	const before = s.character.core.features.length;
	const ticks: Op[] = Array.from({ length: 6 }, () => ({ op: 'progress.tick', activity: 'combat' }));
	s = applyOps(s, ticks, { day: 1 }).state;
	assert.equal(s.progress!.counters.combat, 6);
	assert.ok(s.character.core.features.includes('Закалён в бою'));
	assert.equal(s.character.core.features.length, before + 1);
});

test('B6: профильная особенность требует модуль (cast → нужен magic)', () => {
	let warrior = createCharacter({ name: 'В', race: 'человек', age_band: 'зрелый', direction: 'военный', seed: 2 });
	const ticks: Op[] = Array.from({ length: 6 }, () => ({ op: 'progress.tick', activity: 'cast' }));
	warrior = applyOps(warrior, ticks, { day: 1 }).state;
	assert.ok(!warrior.character.core.features.includes('Уверенный в касте'), 'без magic не выдаётся');
	assert.equal(warrior.progress!.counters.cast, 6);
});

test('B6: persuade-особенность не требует модуля; выдаётся один раз', () => {
	let s = createCharacter({ name: 'Купец', race: 'человек', age_band: 'зрелый', direction: 'торговец', seed: 3 });
	const ticks: Op[] = Array.from({ length: 7 }, () => ({ op: 'progress.tick', activity: 'persuade' }));
	s = applyOps(s, ticks, { day: 1 }).state;
	const count = s.character.core.features.filter((f) => f === 'Опытный переговорщик').length;
	assert.equal(count, 1, 'не дублируется');
});
