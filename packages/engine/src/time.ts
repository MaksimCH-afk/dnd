/**
 * Время и путешествия (ТЗ §9.6, systems.md ч.II). Движок ведёт день/время суток/
 * сезон; быт сворачивается в строку (без счётчиков голода/гигиены).
 */

import type { Season } from './economy';
import type { SessionState } from './state';

export const TIME_SLOTS = ['утро', 'день', 'вечер', 'ночь'] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

/** Год = 360 дней = 12 мес × 30; зима 1–3, весна 4–6, лето 7–9, осень 10–12. */
export function seasonOfDay(day: number): Season {
	const month = Math.floor((((day - 1) % 360) + 360) % 360 / 30) + 1;
	if (month <= 3) return 'зима';
	if (month <= 6) return 'весна';
	if (month <= 9) return 'лето';
	return 'осень';
}

/** Продвинуть время на N слотов суток и/или дней. Возвращает новую сессию. */
export function advanceTime(session: SessionState, opts: { slots?: number; days?: number }): SessionState {
	let dayOffset = opts.days ?? 0;
	let idx = TIME_SLOTS.indexOf(session.time_of_day) + (opts.slots ?? 0);
	dayOffset += Math.floor(idx / TIME_SLOTS.length);
	idx = ((idx % TIME_SLOTS.length) + TIME_SLOTS.length) % TIME_SLOTS.length;
	const day = session.day + dayOffset;
	return { ...session, day, time_of_day: TIME_SLOTS[idx]!, season: seasonOfDay(day) };
}

export type TravelMode = 'пешком' | 'верхом' | 'повозка' | 'корабль';
const SPEED_KM_PER_DAY: Record<TravelMode, number> = {
	пешком: 35,
	верхом: 90,
	повозка: 40,
	корабль: 300
};

export interface TravelModifiers {
	heavyLoad?: boolean; // −30%
	heavyArmor?: boolean; // −20%
	goodRoad?: boolean; // +20%
	offRoad?: boolean; // −40%
	rain?: boolean; // −20%
	snow?: boolean; // −40%
	nightNoLight?: boolean; // −50%
}

/** Дней в пути на дистанцию (округление вверх до 0.5 дня). */
export function travelDays(distanceKm: number, mode: TravelMode, mods: TravelModifiers = {}): number {
	let speed = SPEED_KM_PER_DAY[mode];
	const factor =
		(mods.heavyLoad ? 0.7 : 1) *
		(mods.heavyArmor ? 0.8 : 1) *
		(mods.goodRoad ? 1.2 : 1) *
		(mods.offRoad ? 0.6 : 1) *
		(mods.rain ? 0.8 : 1) *
		(mods.snow ? 0.6 : 1) *
		(mods.nightNoLight ? 0.5 : 1);
	speed *= factor;
	const days = distanceKm / speed;
	return Math.max(0.5, Math.round(days * 2) / 2);
}

export type RestType = 'короткий отдых' | 'сон' | 'постельный режим' | 'уход лекаря';
const HEAL_PER_DAY: Record<RestType, number> = {
	'короткий отдых': 5, // разово
	сон: 10,
	'постельный режим': 20,
	'уход лекаря': 30
};
export function healPerDay(rest: RestType): number {
	return HEAL_PER_DAY[rest];
}

/** Ориентир срока заживления по степени раны (дни). */
export function woundHealDays(stage: 'лёгкая' | 'средняя' | 'тяжёлая' | 'критическая'): [number, number] {
	switch (stage) {
		case 'лёгкая':
			return [2, 3];
		case 'средняя':
			return [6, 8];
		case 'тяжёлая':
			return [14, 21];
		case 'критическая':
			return [30, 60];
	}
}
