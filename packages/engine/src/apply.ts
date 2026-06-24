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
import type { GameState, InventoryItem, ModuleName } from './state';

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
				if (rep) {
					rep.hidden[op.axis] = (rep.hidden[op.axis] ?? 0) + op.delta;
					ok(op, `${op.faction}/${op.axis} ${op.delta} (скрыто)`);
				} else {
					reject(op, `фракция «${op.faction}» неизвестна (создаётся при первой встрече, Фаза 4)`);
				}
				break;
			}

			default:
				// Прочие операции (npc.*, contract.*, location.*, timer.*, power.set,
				// darkcost.advance, и т.п.) реализуются в фазах 2–5.
				reject(op, `операция пока не реализована (фаза 2–5)`);
		}
	}

	state.character.core.updated_day = ctx.day;
	return { ok: rejected.length === 0, state, applied, rejected, log };
}
