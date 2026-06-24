/**
 * Извлечение предложенных нарратором операций из прозы.
 *
 * Фаза 1: нарратор опционально добавляет блок ```ops с JSON-массивом Op[].
 * Это надёжнее function-calling на free-моделях; движок всё равно валидирует.
 * LLM-нормализатор «плавающих» tool-call'ов — Фаза 3 (ТЗ §7.3).
 */

import type { Op } from '@rpg/engine';

const FENCE = /```ops\s*([\s\S]*?)```/i;

export interface Extracted {
	/** Проза без служебного блока ops (для показа игроку). */
	clean: string;
	ops: Op[];
}

export function extractOps(text: string): Extracted {
	const match = text.match(FENCE);
	if (!match) return { clean: text.trim(), ops: [] };

	const clean = text.replace(FENCE, '').trim();
	let ops: Op[] = [];
	try {
		const parsed = JSON.parse(match[1]!.trim());
		if (Array.isArray(parsed)) {
			ops = parsed.filter((o): o is Op => o && typeof o === 'object' && typeof o.op === 'string');
		}
	} catch {
		// Невалидный JSON — игнорируем блок, движок просто не получит операций.
	}
	return { clean, ops };
}
