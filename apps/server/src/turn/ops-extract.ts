/** Извлечение предложенных нарратором операций из прозы (порт с клиента). */
import type { Op } from '@rpg/engine';

const FENCE = /```ops\s*([\s\S]*?)```/i;

export function extractOps(text: string): { clean: string; ops: Op[] } {
	const match = text.match(FENCE);
	if (!match) return { clean: text.trim(), ops: [] };
	const clean = text.replace(FENCE, '').trim();
	let ops: Op[] = [];
	try {
		const parsed = JSON.parse(match[1]!.trim());
		if (Array.isArray(parsed)) ops = parsed.filter((o): o is Op => o && typeof o === 'object' && typeof o.op === 'string');
	} catch {
		/* невалидный JSON — игнор */
	}
	return { clean, ops };
}

const DARK = ['инквиз', 'пытк', 'пыта', 'кровь', 'кровав', 'некромант', 'нежит', 'труп', 'мертвец', 'жертвоприношен', 'культ', 'казн', 'резня', 'демон', 'проклят', 'тёмн', 'пожира', 'мучен'];
export function isDarkScene(...texts: (string | undefined)[]): boolean {
	const hay = texts.filter(Boolean).join(' ').toLowerCase();
	return DARK.some((p) => hay.includes(p));
}
