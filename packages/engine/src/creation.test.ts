import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacter, type CreationChoices } from './creation';
import { applyOps } from './apply';
import { activeModules } from './state';

function make(partial: Partial<CreationChoices>): CreationChoices {
	return { name: 'Имя', race: 'человек', age_band: 'зрелый', direction: 'наёмник', ...partial };
}

test('R1: воин — combat_mastery, без магии и без Силы при любом сиде', () => {
	for (let seed = 1; seed <= 60; seed++) {
		const s = createCharacter(make({ direction: 'военный', seed }));
		assert.equal(s.character.modules.magic, undefined, `сид ${seed}: у воина нет magic`);
		assert.ok(s.character.modules.combat_mastery, 'есть combat_mastery');
	}
	const s = createCharacter(make({ direction: 'военный', seed: 1 }));
	assert.deepEqual(activeModules(s).sort(), ['combat_mastery']);
});

test('R1: шпион (преступник) — intrigue, без магии', () => {
	for (let seed = 1; seed <= 60; seed++) {
		const s = createCharacter(make({ direction: 'преступник', seed }));
		assert.equal(s.character.modules.magic, undefined);
		assert.ok(s.character.modules.intrigue, 'есть intrigue');
	}
});

test('R1: академик может стартовать с магией (стихийная, Новичок)', () => {
	let found = false;
	for (let seed = 1; seed <= 60 && !found; seed++) {
		const s = createCharacter(make({ direction: 'академик', seed }));
		if (s.character.modules.magic) {
			found = true;
			assert.equal(s.character.modules.magic.schools[0]!.school, 'стихийная');
			assert.equal(s.character.modules.magic.schools[0]!.mastery, 'Новичок');
			assert.equal(s.character.modules.magic.power, 'Полон');
		}
	}
	assert.ok(found, 'хотя бы при одном сиде академик одарён');
});

test('R1: гейтинг — power.set отклоняется у воина, проходит у мага', () => {
	const warrior = createCharacter(make({ direction: 'военный', seed: 3 }));
	const rWar = applyOps(warrior, [{ op: 'power.set', state: 'Истощён' }], { day: 1 });
	assert.equal(rWar.applied.length, 0);
	assert.equal(rWar.rejected.length, 1);

	// Найдём одарённого академика.
	let mage = createCharacter(make({ direction: 'академик', seed: 1 }));
	for (let seed = 1; seed <= 60 && !mage.character.modules.magic; seed++) {
		mage = createCharacter(make({ direction: 'академик', seed }));
	}
	assert.ok(mage.character.modules.magic, 'нашли мага');
	const rMage = applyOps(mage, [{ op: 'power.set', state: 'На исходе' }], { day: 1 });
	assert.equal(rMage.rejected.length, 0);
	assert.equal(rMage.state.character.modules.magic!.power, 'На исходе');
});

test('тёмная дорожка → подозрительная репутация и тёмная дуга', () => {
	let dark = createCharacter(make({ direction: 'академик', darkPath: true, seed: 1 }));
	for (let seed = 1; seed <= 60 && !dark.character.modules.magic; seed++) {
		dark = createCharacter(make({ direction: 'академик', darkPath: true, seed }));
	}
	assert.ok(dark.character.modules.magic);
	assert.ok(dark.character.modules.magic!.dark_arcs.length >= 1, 'есть тёмная дуга');
	assert.equal(dark.character.modules.magic!.mage_type, 'своесильный');
	assert.ok(dark.character.core.reputation.some((r) => r.tier === 'Подозрительный'));
});

test('HP/выносливость выводятся из CON; детерминизм по сиду', () => {
	const a = createCharacter(make({ direction: 'наёмник', seed: 42 }));
	const b = createCharacter(make({ direction: 'наёмник', seed: 42 }));
	assert.deepEqual(a, b, 'один сид → идентичное состояние');
	const con = a.character.core.attrs.CON;
	assert.equal(a.character.core.stamina.max, con * 10);
	// HP = CON*(5..7) + бонус направления (наёмник +5)
	assert.ok(a.character.core.hp.max >= con * 5 + 5 && a.character.core.hp.max <= con * 7 + 5);
});
