/**
 * Транзакционное применение операций (ТЗ §8.6, §7.3) — детерминированное ядро.
 *
 * РЕШАЕТ БАГ №5: инвентарь НИКОГДА не пересобирается по памяти — только
 * дельта-операции. Набор предметов = прежний ± явные операции; заряды считаются.
 * Невалидные операции отклоняются с логом, валидные применяются атомарно к копии.
 *
 * Движок — источник истины. Модели сюда передают только намерения (Op[]);
 * детерминированные проверки здесь, не в LLM.
 */

import type { Op, OpName } from './ops';
import { OP_MODULE_REQUIREMENT } from './ops';
import type { Contract, GameState, InventoryItem, ModuleName, NpcCore } from './state';
import { tierFromHidden } from './reputation';

export interface ApplyContext {
	/** Текущий игровой день (для acquired_day/journal). */
	day: number;
	/** Генератор id предметов (детерминируемый). */
	makeItemId?: (seed: string, index: number) => string;
	/** Сколько записей капитала держать в журнале. */
	journalLimit?: number;
}

export interface Rejection {
	op: Op;
	reason: string;
}

export interface ApplyResult {
	ok: boolean;
	state: GameState;
	applied: Op[];
	rejected: Rejection[];
	/** Лог для `/ask` (под капотом). */
	log: string[];
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

function clone(state: GameState): GameState {
	return structuredClone(state);
}

function defaultItemId(seed: string, index: number): string {
	const slug = seed
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 24);
	return `it_${slug || 'item'}_${index}`;
}

/**
 * Применяет операции к состоянию. Возвращает НОВОЕ состояние (исходное не мутируется).
 * Невалидные операции отклоняются индивидуально (валидные — применяются).
 */
export function applyOps(prev: GameState, ops: Op[], ctx: ApplyContext): ApplyResult {
	const state = clone(prev);
	const applied: Op[] = [];
	const rejected: Rejection[] = [];
	const log: string[] = [];
	const active = new Set<ModuleName>(Object.keys(state.character.modules) as ModuleName[]);
	const makeItemId = ctx.makeItemId ?? defaultItemId;
	const journalLimit = ctx.journalLimit ?? 12;

	const reject = (op: Op, reason: string) => {
		rejected.push({ op, reason });
		log.push(`✕ ${op.op}: ${reason}`);
	};
	const ok = (op: Op, note: string) => {
		applied.push(op);
		log.push(`✓ ${op.op}: ${note}`);
	};

	let addedCount = 0;

	for (const op of ops) {
		// Гейтинг модуль-зависимых операций (ТЗ §7.3).
		const required = OP_MODULE_REQUIREMENT[op.op as OpName];
		if (required && !active.has(required as ModuleName)) {
			reject(op, `модуль «${required}» не активен у персонажа`);
			continue;
		}

		switch (op.op) {
			case 'capital.change': {
				const next = state.inventory.capital_mp + op.delta;
				if (next < 0) {
					reject(op, `капитал ушёл бы в минус (${state.inventory.capital_mp} + ${op.delta})`);
					break;
				}
				state.inventory.capital_mp = next;
				state.inventory.journal.push({ day: ctx.day, delta: op.delta, reason: op.reason });
				if (state.inventory.journal.length > journalLimit) {
					state.inventory.journal = state.inventory.journal.slice(-journalLimit);
				}
				ok(op, `${op.delta} MP (${op.reason}) → ${next} MP`);
				break;
			}

			case 'item.add': {
				const it = op.item;
				if (!it?.name || it.qty == null || it.qty <= 0) {
					reject(op, 'у предмета нет имени/корректного количества');
					break;
				}
				const id = makeItemId(it.name, state.inventory.items.length + addedCount);
				const item: InventoryItem = {
					id,
					name: it.name,
					qty: it.qty,
					slot: it.slot ?? 'сумка',
					magical: it.magical ?? false,
					acquired_day: ctx.day,
					...(it.charges != null ? { charges: it.charges } : {}),
					...(it.notes ? { notes: it.notes } : {})
				};
				state.inventory.items.push(item);
				addedCount++;
				ok(op, `+${it.qty}× ${it.name} (${id})`);
				break;
			}

			case 'item.remove': {
				const idx = state.inventory.items.findIndex((i) => i.id === op.id);
				if (idx === -1) {
					reject(op, `предмет ${op.id} не найден (инвентарь не пересобирается по памяти)`);
					break;
				}
				const item = state.inventory.items[idx]!;
				if (op.qty <= 0) {
					reject(op, 'количество к снятию должно быть > 0');
					break;
				}
				if (op.qty > item.qty) {
					reject(op, `нельзя снять ${op.qty}, в наличии ${item.qty}× ${item.name}`);
					break;
				}
				item.qty -= op.qty;
				if (item.qty === 0) state.inventory.items.splice(idx, 1);
				ok(op, `−${op.qty}× ${item.name} (${op.reason})`);
				break;
			}

			case 'item.update': {
				const item = state.inventory.items.find((i) => i.id === op.id);
				if (!item) {
					reject(op, `предмет ${op.id} не найден`);
					break;
				}
				const f = op.fields;
				if (f.name != null) item.name = f.name;
				if (f.qty != null) {
					if (f.qty < 0) {
						reject(op, 'qty не может быть отрицательным');
						break;
					}
					item.qty = f.qty;
				}
				if (f.charges != null) item.charges = f.charges;
				if (f.slot != null) item.slot = f.slot;
				if (f.magical != null) item.magical = f.magical;
				if (f.notes != null) item.notes = f.notes;
				ok(op, `обновлён ${item.name}`);
				break;
			}

			case 'hp.change': {
				const c = state.character.core.hp;
				c.cur = clamp(c.cur + op.delta, 0, c.max);
				ok(op, `HP ${op.delta} → ${c.cur}/${c.max} (${op.reason})`);
				break;
			}

			case 'stamina.change': {
				const c = state.character.core.stamina;
				c.cur = clamp(c.cur + op.delta, 0, c.max);
				ok(op, `выносливость ${op.delta} → ${c.cur}/${c.max} (${op.reason})`);
				break;
			}

			case 'status.add': {
				if (!state.character.core.statuses.some((s) => s.effect === op.effect)) {
					state.character.core.statuses.push({ effect: op.effect, ...(op.notes ? { notes: op.notes } : {}) });
				}
				ok(op, op.effect);
				break;
			}

			case 'status.remove': {
				state.character.core.statuses = state.character.core.statuses.filter((s) => s.effect !== op.effect);
				ok(op, `снят ${op.effect}`);
				break;
			}

			case 'feature.grant': {
				if (!state.character.core.features.includes(op.name)) {
					state.character.core.features.push(op.name);
				}
				ok(op, op.name);
				break;
			}

			case 'fact.add': {
				const id = `f_${state.facts.length}`;
				state.facts.push({
					id,
					text: op.text,
					scope: op.scope,
					known_by: op.known_by ?? [],
					tags: op.tags ?? [],
					created_day: ctx.day
				});
				ok(op, `факт ${id} (scope=${op.scope})`);
				break;
			}

			case 'reputation.shift': {
				const rep = state.character.core.reputation.find((r) => r.faction === op.faction);
				const target = rep ?? { faction: op.faction, tier: 'Нейтрален' as const, hidden: { доверие: 0, страх: 0, долг: 0, вражда: 0, романтика: 0 } };
				target.hidden[op.axis] = (target.hidden[op.axis] ?? 0) + op.delta;
				target.tier = tierFromHidden(target.hidden);
				if (!rep) state.character.core.reputation.push(target);
				ok(op, `${op.faction}/${op.axis} ${op.delta} → ${target.tier} (скрыто)`);
				break;
			}

			// --- NPC (ТЗ §4.6, §9.9) ---

			case 'npc.spawn': {
				const sc = op.seed_card as Partial<NpcCore> & {
					id?: string;
					persistent?: boolean;
					location_id?: string;
					mood?: string;
				};
				if (!sc.name || typeof sc.name !== 'string') {
					reject(op, 'seed_card без имени');
					break;
				}
				const id = sc.id ?? `npc_${state.npc.length}`;
				if (state.npc.some((n) => n.id === id)) {
					reject(op, `npc id ${id} уже занят`);
					break;
				}
				const core: NpcCore = {
					name: sc.name,
					race: sc.race ?? 'человек',
					age: sc.age ?? 30,
					estate: sc.estate ?? 'простолюдин',
					role: sc.role ?? 'прохожий',
					speech_register: sc.speech_register ?? 'простой',
					character: sc.character ?? 'обычный',
					motivation: sc.motivation ?? '—',
					secret: sc.secret ?? '—',
					appearance: sc.appearance ?? ''
				};
				state.npc.push({
					id,
					persistent: sc.persistent ?? false,
					core,
					living: {
						mood: sc.mood ?? 'нейтральное',
						last_interactions: [],
						last_seen_day: ctx.day,
						...(sc.location_id ? { location_id: sc.location_id } : {})
					}
				});
				ok(op, `NPC ${core.name} (${id})`);
				break;
			}

			case 'npc.alter_core': {
				const npc = state.npc.find((n) => n.id === op.id);
				if (!npc) {
					reject(op, `NPC ${op.id} не найден`);
					break;
				}
				if (!op.cause || !String(op.cause).trim()) {
					reject(op, 'npc.alter_core требует причину (защита от дрейфа, №4)');
					break;
				}
				const allowed: (keyof NpcCore)[] = ['name', 'race', 'age', 'estate', 'role', 'speech_register', 'character', 'motivation', 'secret', 'appearance'];
				const changed: string[] = [];
				for (const k of allowed) {
					if (k in op.fields && op.fields[k] != null) {
						(npc.core[k] as unknown) = op.fields[k];
						changed.push(k);
					}
				}
				npc.core_changes = [...(npc.core_changes ?? []), { day: ctx.day, cause: op.cause, fields: changed }];
				ok(op, `ядро ${npc.id} изменено [${changed.join(',')}] — причина: ${op.cause}`);
				break;
			}

			case 'npc.relationship': {
				const edge = state.relationships.find((r) => r.from === op.from && r.to === op.to && r.axis === op.axis);
				if (edge) {
					edge.level += op.delta;
					if (op.notes) edge.notes = op.notes;
				} else {
					state.relationships.push({ from: op.from, to: op.to, axis: op.axis, level: op.delta, ...(op.notes ? { notes: op.notes } : {}) });
				}
				ok(op, `${op.from}→${op.to}/${op.axis} ${op.delta}`);
				break;
			}

			// --- Модуль-зависимые (гейтинг выше уже пройден) ---

			case 'power.set': {
				state.character.modules.magic!.power = op.state;
				ok(op, `Сила → ${op.state}`);
				break;
			}

			case 'darkcost.advance': {
				const magic = state.character.modules.magic!;
				const existing = magic.dark_arcs.find((a) => a.arc === op.arc);
				if (existing) {
					existing.hidden_progress += 1;
					existing.note = op.reason;
				} else {
					magic.dark_arcs.push({ arc: op.arc as never, note: op.reason, hidden_progress: 1 });
				}
				ok(op, `тёмная дуга «${op.arc}»: ${op.reason}`);
				break;
			}

			case 'heat.change': {
				const intr = state.character.modules.intrigue!;
				intr.heat = Math.max(0, intr.heat + op.delta);
				ok(op, `след ${op.delta} → ${intr.heat} (${op.reason})`);
				break;
			}

			case 'faith.shift': {
				const faith = state.character.modules.faith!;
				faith.faith += op.delta;
				ok(op, `вера ${op.delta} → ${faith.faith} (${op.reason})`);
				break;
			}

			case 'craft.progress': {
				const craft = state.character.modules.craft!;
				if (typeof op.fields.level === 'string') craft.level = op.fields.level;
				if (typeof op.fields.guild_status === 'string') craft.guild_status = op.fields.guild_status;
				if (Array.isArray(op.fields.recipes)) craft.recipes = op.fields.recipes as string[];
				ok(op, `ремесло обновлено`);
				break;
			}

			// --- Контракты / локации / таймеры / прогрессия (ТЗ §9.7, §9.8, §9.11) ---

			case 'contract.offer': {
				const f = op.fields as Partial<Contract> & { title?: string };
				const id = (f.id as string) ?? `c_${state.contracts.length}`;
				if (!f.title) {
					reject(op, 'контракт без title');
					break;
				}
				state.contracts.push({
					id,
					title: f.title,
					status: 'предложен',
					objectives: f.objectives ?? [],
					...(f.giver_npc ? { giver_npc: f.giver_npc } : {}),
					...(f.reward ? { reward: f.reward } : {}),
					...(f.deadline_day != null ? { deadline_day: f.deadline_day } : {}),
					...(f.faction ? { faction: f.faction } : {}),
					...(f.notes ? { notes: f.notes } : {})
				});
				ok(op, `контракт «${f.title}» (${id})`);
				break;
			}

			case 'contract.update': {
				const c = state.contracts.find((x) => x.id === op.id);
				if (!c) {
					reject(op, `контракт ${op.id} не найден`);
					break;
				}
				Object.assign(c, op.fields);
				ok(op, `контракт ${op.id} обновлён`);
				break;
			}

			case 'contract.close': {
				const c = state.contracts.find((x) => x.id === op.id);
				if (!c) {
					reject(op, `контракт ${op.id} не найден`);
					break;
				}
				c.status = op.status;
				ok(op, `контракт ${op.id} → ${op.status}`);
				break;
			}

			case 'location.note': {
				const loc = state.locations.find((l) => l.id === op.id);
				if (loc) {
					Object.assign(loc, op.fields);
					ok(op, `локация ${op.id} обновлена`);
				} else {
					const f = op.fields as { name?: string; region?: string; type?: string };
					state.locations.push({
						id: op.id,
						name: f.name ?? op.id,
						region: f.region ?? '—',
						type: f.type ?? 'место'
					});
					ok(op, `локация ${op.id} создана`);
				}
				break;
			}

			case 'timer.add': {
				const id = `t_${state.timers.length}`;
				state.timers.push({ id, label: op.label, due_day: op.due_day, type: op.type, ...(op.payload ? { payload: op.payload } : {}) });
				ok(op, `таймер «${op.label}» → День ${op.due_day}`);
				break;
			}

			case 'timer.fire': {
				const idx = state.timers.findIndex((t) => t.id === op.id);
				if (idx === -1) {
					reject(op, `таймер ${op.id} не найден`);
					break;
				}
				const [fired] = state.timers.splice(idx, 1);
				ok(op, `таймер сработал: ${fired!.label}`);
				break;
			}

			case 'seed.plant': {
				state.seeds.push({
					id: `seed_${state.seeds.length}`,
					description: op.description,
					trigger: op.trigger,
					payload: op.payload ?? {},
					tags: op.tags ?? [],
					planted_day: ctx.day
				});
				ok(op, `посеяно отложенное последствие: ${op.description}`);
				break;
			}

			case 'specialization.offer': {
				state.session.open_threads.push(`Специализация на выбор: ${op.options.join(' / ')}`);
				ok(op, `предложены специализации: ${op.options.join(', ')}`);
				break;
			}

			default:
				// Не достижимо: все варианты Op обработаны выше.
				reject(op, `неизвестная операция`);
		}
	}

	state.character.core.updated_day = ctx.day;
	return { ok: rejected.length === 0, state, applied, rejected, log };
}
