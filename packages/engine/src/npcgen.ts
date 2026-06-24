/**
 * Процедурная генерация проходных NPC (ТЗ §9.9, creation.md шаг 5):
 * тип → имя по расе → возраст → черта → мотивация → стартовое отношение
 * (с модификаторами: раса/вид/известная репутация героя).
 *
 * При спавне назначается scope знания: что NPC знает публично; тайны героя — нет.
 */

import type { Rng } from './rng';
import type { Npc, NpcCore, Race } from './state';

const NAMES: Record<Race, string[]> = {
	человек: ['Эрик', 'Марта', 'Гарен', 'Лина', 'Тобиас', 'Вера', 'Освальд', 'Нэлла'],
	'светлый эльф': ['Аэлинор', 'Сильвея', 'Таэрон', 'Иллиан', 'Фэйра'],
	'тёмный эльф': ['Зир', 'Налара', 'Виркс', 'Сэльвет', 'Драэн'],
	гном: ['Бром', 'Дургин', 'Хельга', 'Торин', 'Гудрун'],
	полурослик: ['Пиппин', 'Роза', 'Мило', 'Бэлла', 'Сэм'],
	орк: ['Гром', 'Уртук', 'Шарга', 'Морг', 'Брака'],
	полуэльф: ['Кейл', 'Ниэль', 'Дарин', 'Эльза', 'Рован']
};

const TRAITS = ['нервный', 'самоуверенный', 'усталый', 'добродушный', 'подозрительный', 'хитрый', 'грубоватый', 'скрытный', 'словоохотливый', 'мрачный'];
const MOTIVES = ['ищет работника', 'боится за свою жизнь', 'хочет разбогатеть', 'мстит за обиду', 'защищает семью', 'жаждет знаний', 'спасается от долгов', 'ищет пропавшего', 'служит господину', 'хочет покоя'];

export type Attitude = 'враждебное' | 'недружелюбное' | 'подозрительное' | 'нейтральное' | 'дружелюбное' | 'союзническое';
const ATTITUDE_ORDER: Attitude[] = ['враждебное', 'недружелюбное', 'подозрительное', 'нейтральное', 'дружелюбное', 'союзническое'];

export interface SpawnOpts {
	race?: Race;
	role?: string;
	estate?: string;
	persistent?: boolean;
	location_id?: string;
	day: number;
	/** Известная репутация героя — сдвигает стартовое отношение. */
	heroDisposition?: 'светлая' | 'тёмная' | 'нейтральная';
	/** Раса героя (дроу/орки встречают недоверие). */
	heroRace?: Race;
}

function attitudeShift(base: number, shift: number): Attitude {
	const i = Math.max(0, Math.min(ATTITUDE_ORDER.length - 1, base + shift));
	return ATTITUDE_ORDER[i]!;
}

/** Сгенерировать проходного NPC. */
export function spawnNpc(rng: Rng, id: string, opts: SpawnOpts): Npc {
	const race = opts.race ?? rng.pick<Race>(['человек', 'человек', 'человек', 'гном', 'полурослик', 'полуэльф']);
	const name = rng.pick(NAMES[race]);
	const age = rng.int(18, 60);
	const trait = rng.pick(TRAITS);
	const motivation = rng.pick(MOTIVES);
	const role = opts.role ?? rng.pick(['торговец', 'стражник', 'трактирщик', 'крестьянин', 'путник', 'ремесленник']);

	// Стартовое отношение: база нейтральное (индекс 3), модификаторы.
	let shift = rng.int(-1, 1);
	if (opts.heroDisposition === 'тёмная') shift -= 1;
	if (opts.heroRace === 'тёмный эльф' || opts.heroRace === 'орк') shift -= 1;
	const attitude = attitudeShift(3, shift);

	const core: NpcCore = {
		name,
		race,
		age,
		estate: opts.estate ?? 'простолюдин',
		role,
		speech_register: race === 'светлый эльф' ? 'возвышенный' : 'простой',
		character: trait,
		motivation,
		secret: '—',
		appearance: `${race}, ${age} лет, ${trait} вид`
	};

	return {
		id,
		persistent: opts.persistent ?? false,
		core,
		living: {
			mood: attitude,
			...(opts.location_id ? { location_id: opts.location_id } : {}),
			last_interactions: [],
			last_seen_day: opts.day
		}
	};
}
