/**
 * Сквозной прогон связок (бета-тест), без браузера и без ключа: мокаем ответ
 * нарратора строкой с блоком ```ops``` и гоняем реальные модули фронта + движок.
 * Запуск: pnpm --filter @rpg/web exec tsx beta-e2e.mts
 */
import assert from 'node:assert/strict';
import { createCharacter, applyOps, migrate, pickNextArc, beginArc, tickSeeds, tickWorld, makeRng } from '@rpg/engine';
import { extractOps } from './src/lib/ops-extract.ts';
import { statusFields, formatMoney, threadModel } from './src/lib/status.ts';
import { buildSaveBundle, buildGoReport, buildSaveReport } from './src/lib/reports.ts';
import { buildNarratorMessages } from './src/lib/prompt.ts';
import { isDarkScene } from './src/lib/darkscene.ts';

let pass = 0;
const ok = (name: string) => { pass++; console.log(`  ✓ ${name}`); };

// 1) Создание персонажа (воин — без магии)
let state = createCharacter({ name: 'Гарен', race: 'человек', age_band: 'зрелый', direction: 'военный', seed: 11 });
assert.equal(state.character.modules.magic, undefined);
assert.ok(state.character.modules.combat_mastery);
ok('создание: воин без магии, есть combat_mastery');

// 2) Сборка промпта нарратора (scoped-контекст)
const msgs = buildNarratorMessages(state, [], 'Осматриваюсь в таверне.');
assert.equal(msgs[0]!.role, 'system');
assert.ok(msgs[0]!.content.includes('combat_mastery'));
assert.ok(msgs[0]!.content.includes('Короткий меч') || msgs[0]!.content.includes('меч'));
assert.equal(msgs.at(-1)!.content, 'Осматриваюсь в таверне.');
ok('промпт: системный со срезом состояния + ввод игрока');

// 3) Мок ответа нарратора с блоком ops → extractOps
const narratorOutput = `Ты входишь в полумрак таверны. Хозяин кивает.

\`\`\`ops
[ {"op":"capital.change","delta":-20,"reason":"эль и похлёбка"},
  {"op":"item.add","item":{"name":"Глиняная кружка","qty":1,"slot":"сумка"}},
  {"op":"npc.spawn","seed_card":{"id":"npc_host","name":"Освальд","role":"трактирщик","character":"усталый, ворчливый"}},
  {"op":"fact.add","text":"в городе ярмарка через 3 дня","scope":"public","known_by":[],"tags":["слух"]} ]
\`\`\``;
const { clean, ops } = extractOps(narratorOutput);
assert.ok(!clean.includes('```'), 'служебный блок убран из прозы');
assert.equal(ops.length, 4);
ok('extractOps: проза очищена, 4 операции распознаны');

// 4) Применение операций движком
const capBefore = state.inventory.capital_mp;
const res = applyOps(state, ops, { day: state.session.day });
assert.equal(res.rejected.length, 0, 'все операции валидны');
state = res.state;
assert.equal(state.inventory.capital_mp, capBefore - 20);
assert.ok(state.inventory.items.some((i) => i.name === 'Глиняная кружка'));
assert.ok(state.npc.some((n) => n.id === 'npc_host'));
assert.ok(state.facts.some((f) => f.scope === 'public' && /ярмарка/.test(f.text)));
ok('движок: дельты применены (капитал/предмет/NPC/факт)');

// 5) Статус-блок и нить состояния (адаптивно под сборку)
const fields = statusFields(state);
assert.ok(fields.find((f) => f.label === 'HP'));
assert.ok(!fields.find((f) => f.label === 'Сила'), 'у воина нет строки Силы');
const thread = threadModel(state);
assert.equal(thread.label, 'Выносливость / раны');
ok(`статус/нить: адаптивны (нить = «${thread.label}», деньги = ${formatMoney(state.inventory.capital_mp)})`);

// 6) NPC в сцене → карточка дословно в промпте, без утечки тайн
state.session.npcs_in_scene = ['npc_host'];
const msgs2 = buildNarratorMessages(state, [], 'Заговариваю с хозяином.');
assert.ok(msgs2[0]!.content.includes('Освальд'));
assert.ok(msgs2[0]!.content.includes('тайн героя НЕ знает') || msgs2[0]!.content.includes('знает:'));
ok('NPC: карточка в сцене попадает в промпт');

// 7) Отчёты /go и /save + сейв-бандл
assert.ok(buildGoReport(state).includes('Гарен'));
assert.ok(buildSaveReport(state, res).includes('СОХРАНЕНО'));
const bundle = buildSaveBundle(state);
assert.ok(bundle['char_sheet.md']!.includes('Гарен'));
assert.ok(bundle['char_inventory.md']!.includes('Глиняная кружка'));
ok('отчёты /go,/save и md-рендер канона');

// 8) save → load (миграция) — состояние идентично
const reloaded = migrate(JSON.parse(bundle['canon.json']!)).state;
assert.deepEqual(reloaded.inventory.items, state.inventory.items);
assert.equal(reloaded.schema_version, state.schema_version);
ok('save/load: канон переживает сериализацию + миграцию');

// 9) Тёмная сцена → фоллбэк
assert.equal(isDarkScene('к двери подходит инквизитор с клеймом'), true);
assert.equal(isDarkScene('торгуюсь за хлеб на рынке'), false);
ok('darkscene: эвристика фоллбэка срабатывает корректно');

// 10) Режиссёр + seeds + мир-тик
const rng = makeRng(77);
const arc = pickNextArc(state.arcs, rng);
beginArc(state, arc);
assert.equal(state.arcs.length, 1);
state = applyOps(state, [{ op: 'seed.plant', description: 'долг наступит', trigger: { type: 'time', params: { due_day: state.session.day } }, payload: { text: 'Кредитор у порога.' }, tags: ['долг'] }], { day: state.session.day }).state;
const fired = tickSeeds(state, state.session.day, rng);
assert.equal(fired.fired.length, 1, 'seed срабатывает в срок');
const world = tickWorld(state, makeRng(5));
assert.ok(world.state.world_state);
ok('Режиссёр/seeds/мир: арка начата, seed сработал, мир тикнул');

console.log(`\nИтог сквозного прогона: ${pass}/10 связок OK`);
