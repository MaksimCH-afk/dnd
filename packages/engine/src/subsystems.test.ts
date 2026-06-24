import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from './rng';
import { woundStage, woundPenalty, staminaState, resolveAttack, computeAC, rollDamage, concentrationDC } from './combat';
import { priceFor, REGION_MULT } from './economy';
import { seasonOfDay, advanceTime, travelDays } from './time';
import { tierFromHidden } from './reputation';
import type { SessionState } from './state';

test('R2: раны по % HP (systems.md)', () => {
	assert.equal(woundStage(60, 60), 'нет');
	assert.equal(woundStage(50, 60), 'лёгкая'); // 17%
	assert.equal(woundStage(35, 60), 'средняя'); // 42%
	assert.equal(woundStage(20, 60), 'тяжёлая'); // 67%
	assert.equal(woundStage(5, 60), 'критическая'); // 92%
	assert.equal(woundStage(0, 60), 'смерть');
	assert.equal(woundPenalty('тяжёлая'), -5);
});

test('R2: выносливость по %', () => {
	assert.equal(staminaState(100, 100), 'бодр');
	assert.equal(staminaState(50, 100), 'устал');
	assert.equal(staminaState(30, 100), 'сильно устал');
	assert.equal(staminaState(10, 100), 'изнеможение');
	assert.equal(staminaState(0, 100), 'упал');
});

test('R2: атака — крит на 20, провал на 1; детерминизм по сиду', () => {
	const ac = computeAC({ dex: 12, armor: 2, style: 'обычный' }); // 10+2+2 = 14
	assert.equal(ac, 14);
	const a = resolveAttack({ attackBonus: 3, style: 'обычный', targetAC: ac }, makeRng(1));
	const b = resolveAttack({ attackBonus: 3, style: 'обычный', targetAC: ac }, makeRng(1));
	assert.deepEqual(a, b, 'один сид → один бросок');
	// найдём сид с нат.20 и нат.1
	let crit = false, fumble = false;
	for (let s = 1; s < 200 && !(crit && fumble); s++) {
		const r = resolveAttack({ attackBonus: 0, style: 'обычный', targetAC: 30 }, makeRng(s));
		if (r.crit) { crit = true; assert.equal(r.hit, true); }
		if (r.fumble) { fumble = true; assert.equal(r.hit, false); }
	}
	assert.ok(crit && fumble);
});

test('R2: урон оружия в границах костей; крит удваивает', () => {
	for (let s = 1; s < 50; s++) {
		const d = rollDamage('длинный меч', makeRng(s)); // 1d8
		assert.ok(d >= 1 && d <= 8);
		const c = rollDamage('длинный меч', makeRng(s), { crit: true }); // 2d8
		assert.ok(c >= 2 && c <= 16);
	}
	assert.equal(concentrationDC(30), 15);
	assert.equal(concentrationDC(10), 10);
});

test('R2: цена = диапазон × множитель региона; столица дороже деревни', () => {
	const cap = priceFor('обед в таверне', { region: 'столица' }, makeRng(5));
	const vil = priceFor('обед в таверне', { region: 'деревня' }, makeRng(5));
	assert.ok(cap.mp > vil.mp, 'в столице дороже еды, чем в деревне');
	assert.equal(REGION_MULT['столица'].услуги, 2.0);
	// торг снижает цену
	const noHaggle = priceFor('комната', { region: 'средний город' }, makeRng(9));
	const haggle = priceFor('комната', { region: 'средний город', haggleCha: 16 }, makeRng(9));
	assert.ok(haggle.mp < noHaggle.mp);
});

test('время: сезон по дню, продвижение слотов/дней', () => {
	assert.equal(seasonOfDay(1), 'зима');
	assert.equal(seasonOfDay(100), 'весна'); // месяц 4
	assert.equal(seasonOfDay(200), 'лето'); // месяц 7
	const s: SessionState = { day: 1, time_of_day: 'вечер', season: 'зима', current_moment: '', npcs_in_scene: [], open_threads: [] };
	const next = advanceTime(s, { slots: 2 }); // вечер→ночь→утро(+1 день)
	assert.equal(next.day, 2);
	assert.equal(next.time_of_day, 'утро');
	assert.equal(travelDays(180, 'верхом'), 2); // 180/90
});

test('репутация: скрытый счёт → уровень', () => {
	assert.equal(tierFromHidden({ доверие: 0, страх: 0, долг: 0, вражда: 0, романтика: 0 }), 'Нейтрален');
	assert.equal(tierFromHidden({ доверие: 9, страх: 0, долг: 0, вражда: 0, романтика: 0 }), 'Почитаемый');
	assert.equal(tierFromHidden({ доверие: 0, страх: 0, долг: 0, вражда: 9, романтика: 0 }), 'Презираемый');
	assert.equal(tierFromHidden({ доверие: 0, страх: 0, долг: 0, вражда: 15, романтика: 0 }), 'Враг');
});
