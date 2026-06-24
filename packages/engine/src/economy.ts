/**
 * Экономика — резолвер цен (ТЗ §9.5, systems.md ч.III). Цена = базовый диапазон
 * категории × множитель региона × сезон × торг. Движок выдаёт конкретную цену
 * консистентно; «находки из ниоткуда» отсекает валидатор капитала (apply.ts).
 *
 * Все диапазоны — в серебре (SP); функция возвращает медь (MP): 1 SP = 10 MP.
 */

import type { Rng } from './rng';

export type Region = 'столица' | 'крупный город' | 'средний город' | 'деревня' | 'глушь';
export type PriceKind = 'еда' | 'товары' | 'услуги' | 'недвижимость';
export type Season = 'зима' | 'весна' | 'лето' | 'осень';

/** Множители региона по категориям (systems.md). */
export const REGION_MULT: Record<Region, Record<PriceKind, number>> = {
	столица: { еда: 1.5, товары: 1.3, услуги: 2.0, недвижимость: 3.0 },
	'крупный город': { еда: 1.2, товары: 1.1, услуги: 1.5, недвижимость: 2.0 },
	'средний город': { еда: 1.0, товары: 1.0, услуги: 1.0, недвижимость: 1.0 },
	деревня: { еда: 0.7, товары: 1.3, услуги: 0.6, недвижимость: 0.5 },
	глушь: { еда: 0.5, товары: 2.0, услуги: 0.3, недвижимость: 0.3 }
};

/** Базовые диапазоны (SP) и категория — выборка из systems.md. */
export const PRICE_RANGES: Record<string, { sp: [number, number]; kind: PriceKind }> = {
	хлеб: { sp: [0.2, 0.5], kind: 'еда' },
	'обед в таверне': { sp: [2, 10], kind: 'еда' },
	эль: { sp: [0.5, 1], kind: 'еда' },
	'койка в общем зале': { sp: [5, 5], kind: 'услуги' },
	комната: { sp: [10, 20], kind: 'услуги' },
	'дорожный паёк (неделя)': { sp: [5, 5], kind: 'товары' },
	кинжал: { sp: [10, 200], kind: 'товары' },
	'короткий меч': { sp: [100, 500], kind: 'товары' },
	'длинный меч': { sp: [150, 5000], kind: 'товары' },
	'кожаный доспех': { sp: [50, 200], kind: 'товары' },
	кольчуга: { sp: [500, 1500], kind: 'товары' },
	латы: { sp: [3000, 10000], kind: 'товары' },
	щит: { sp: [30, 100], kind: 'товары' },
	'лечение раны (лекарь)': { sp: [10, 300], kind: 'услуги' },
	'исцеление (жрец)': { sp: [50, 2000], kind: 'услуги' },
	'зелье исцеления': { sp: [50, 10000], kind: 'товары' },
	'верховая лошадь': { sp: [500, 1000], kind: 'товары' }
};

export interface PriceOpts {
	region?: Region;
	season?: Season;
	/** CHA торгующегося — высокий даёт скидку 10–20%. */
	haggleCha?: number;
	/** Прямое указание категории, если товара нет в таблице. */
	kind?: PriceKind;
	/** Явный базовый диапазон (SP), если товара нет в таблице. */
	baseSp?: [number, number];
}

function seasonFactor(kind: PriceKind, season?: Season): number {
	// Зимой свежая еда дорожает (systems.md), осенью урожай дешевле.
	if (kind !== 'еда') return 1;
	if (season === 'зима') return 2;
	if (season === 'осень') return 0.8;
	return 1;
}

export interface PriceResult {
	/** Цена в медных монетах (MP). */
	mp: number;
	/** Цена в серебре (для показа). */
	sp: number;
	kind: PriceKind;
}

/** Консистентная цена товара/услуги. rng обеспечивает выбор внутри диапазона. */
export function priceFor(category: string, opts: PriceOpts, rng: Rng): PriceResult {
	const entry = PRICE_RANGES[category];
	const range = entry?.sp ?? opts.baseSp ?? [1, 10];
	const kind = entry?.kind ?? opts.kind ?? 'товары';

	// База: точка внутри диапазона (логарифмически — широкие диапазоны не задирают).
	const [lo, hi] = range;
	const t = rng.next();
	const baseSp = lo === hi ? lo : Math.exp(Math.log(lo) + t * (Math.log(hi) - Math.log(lo)));

	const regionMult = REGION_MULT[opts.region ?? 'средний город'][kind];
	let sp = baseSp * regionMult * seasonFactor(kind, opts.season);

	// Торг: высокая CHA — скидка 10–20%.
	if (opts.haggleCha != null && opts.haggleCha >= 12) {
		const discount = 0.1 + Math.min(0.1, (opts.haggleCha - 12) * 0.02);
		sp *= 1 - discount;
	}

	const mp = Math.max(1, Math.round(sp * 10));
	return { mp, sp: mp / 10, kind };
}

/** Наценка перепродажи (systems.md): базовое 20–40%, редкое 50–100%, магия 200–500%. */
export function markup(tier: 'базовое' | 'редкое' | 'магия', rng: Rng): number {
	const ranges: Record<typeof tier, [number, number]> = {
		базовое: [0.2, 0.4],
		редкое: [0.5, 1.0],
		магия: [2.0, 5.0]
	} as const;
	const [lo, hi] = ranges[tier];
	return lo + rng.next() * (hi - lo);
}
