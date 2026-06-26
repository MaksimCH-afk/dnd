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

// --- Продвижение времени по весу действия (ТЗ §9.6) ---
// Время ведётся скрыто и грубо: игроку видны день/время суток, минуты не показываются.
// Сутки = 4 слота × 6 ч = 1440 мин. Слоты: утро 0–359, день 360–719, вечер 720–1079, ночь 1080–1439.

const SLOT_MIN = 360;
const DAY_MIN = SLOT_MIN * TIME_SLOTS.length;

/** Грубый «вес» действия во времени — не по числу ходов и не в реальных часах. */
export type TimeScale = 'мгновение' | 'минуты' | 'часы' | 'полдня' | 'день' | 'дни' | 'сон';

const SCALE_MINUTES: Record<Exclude<TimeScale, 'дни' | 'сон'>, number> = {
	мгновение: 0,
	минуты: 15,
	часы: 120,
	полдня: SLOT_MIN,
	день: DAY_MIN
};

function slotStartMin(slot: TimeSlot): number {
	return TIME_SLOTS.indexOf(slot) * SLOT_MIN;
}

/** Скрытые минуты внутри суток (0–1439). Если не велись — выводим из слота. */
export function clockMinutes(session: SessionState): number {
	return session.clock_min ?? slotStartMin(session.time_of_day);
}

/**
 * Продвинуть время по весу действия. Накапливает скрытые минуты, при переходе
 * границ обновляет слот суток и день. `days` — для крупных переходов (дорога/ожидание).
 * 'сон' — до следующего утра.
 */
export function advanceByScale(session: SessionState, scale: TimeScale, days = 0): SessionState {
	const cur = clockMinutes(session);
	let add: number;
	if (scale === 'дни') add = Math.max(1, Math.round(days || 1)) * DAY_MIN;
	else if (scale === 'сон') add = (DAY_MIN - cur + slotStartMin('утро') + DAY_MIN) % DAY_MIN || DAY_MIN;
	else add = SCALE_MINUTES[scale] + (scale === 'день' && days > 1 ? (days - 1) * DAY_MIN : 0);

	const total = cur + add;
	const dayOffset = Math.floor(total / DAY_MIN);
	const within = ((total % DAY_MIN) + DAY_MIN) % DAY_MIN;
	const day = session.day + dayOffset;
	const slotIdx = Math.floor(within / SLOT_MIN);
	return { ...session, day, time_of_day: TIME_SLOTS[slotIdx]!, season: seasonOfDay(day), clock_min: within };
}

/**
 * Грубый классификатор веса действия по тексту (детерминированный фоллбэк, когда
 * нарратор не прислал явный `time.advance`). Консервативен: день-переходы — только
 * на явный сон/ожидание; путешествия лучше двигает нарратор операцией.
 */
export function actionTimeScale(text: string): TimeScale {
	const t = (text ?? '').toLowerCase();
	if (/\bсплю\b|поспа|вы́?спат|переноч|ночлег|на ночь|до утра|ложусь спать/.test(t)) return 'сон';
	if (/\bжд[уёе]|ожида|пережида|до вечера|до утра|весь день|сутки/.test(t)) return 'день';
	if (/тренир|упражня|изуч|исслед|чита[юе]|ритуал|вар[ю и]|кую|лечу|перевяз|молюсь|медитир/.test(t)) return 'часы';
	return 'минуты';
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
