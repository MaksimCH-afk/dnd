/**
 * Детерминированный ГПСЧ (mulberry32) — для скрытых бросков движка.
 * Сид передаётся снаружи (UI/тесты), поэтому создание/броски воспроизводимы
 * и переживают resume. Движок не использует Math.random напрямую.
 */

export interface Rng {
	/** Следующее число [0,1). */
	next(): number;
	/** Целое в [min, max]. */
	int(min: number, max: number): number;
	/** Бросок d20 (1..20). */
	d20(): number;
	/** Случайный элемент массива. */
	pick<T>(arr: readonly T[]): T;
	/** true с вероятностью p (0..1). */
	chance(p: number): boolean;
}

export function makeRng(seed: number): Rng {
	let a = seed >>> 0;
	const next = (): number => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
	return {
		next,
		int,
		d20: () => int(1, 20),
		pick: <T>(arr: readonly T[]): T => arr[int(0, arr.length - 1)] as T,
		chance: (p: number) => next() < p
	};
}

/** Сид из строки (имя персонажа и т.п.) — стабилен между запусками. */
export function seedFromString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
