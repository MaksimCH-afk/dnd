/**
 * Загрузка правил мира из .md и слоистая инъекция в промпт (см. rules_loading_spec.md).
 *
 * Слой A (каждый ход): операционное ядро master.md + тон/ротация world.md + мини-принципы progression.
 * Слой B (по триггеру): magic.md (магия в сцене), religions.md (вера/культ/инквизиция),
 *   creation.md (новая игра), банк завязок world.md → только Режиссёру.
 * Слой C (только движок, в промпт НЕ идёт): systems.md, commands.md и детерминированные части.
 *
 * Источник истины — БД (full_text + prompt_core, с версионированием). При первом старте правила
 * засеиваются из бандла rules/*.md + дефолтных выжимок. Правка в админке применяется горячо
 * (обновляется кэш в памяти — без пересборки кода).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { activeModules, type GameState } from '@rpg/engine';
import type { Db, RuleRow } from './db';

export interface RuleMeta {
	slug: string;
	title: string;
	/** Подсказка для UI: в какие слои инъекции попадает файл. */
	layer: string;
	hint: string;
}

/** Каталог известных файлов правил (8 канонических; можно добавлять свои через UI). */
export const RULE_FILES: RuleMeta[] = [
	{ slug: 'master', title: 'Ведущий (master.md)', layer: 'A', hint: 'Ядро в каждый ход: философия, стиль (2-е лицо), формат ответа, OPS.' },
	{ slug: 'world', title: 'Мир (world.md)', layer: 'A + B', hint: 'Тон и ротация тем — каждый ход; банк завязок — Режиссёру; лор — справочно.' },
	{ slug: 'magic', title: 'Магия (magic.md)', layer: 'B', hint: 'Подмешивается, когда в сцене магия или маг.' },
	{ slug: 'religions', title: 'Религии (religions.md)', layer: 'B', hint: 'Подмешивается при религии / культе / инквизиции.' },
	{ slug: 'creation', title: 'Создание (creation.md)', layer: 'B', hint: 'Только при новой игре.' },
	{ slug: 'progression', title: 'Прогрессия (progression.md)', layer: 'A-мини + C', hint: 'Принципы «словами/нарративом» — в ядро; счётчики — движок.' },
	{ slug: 'commands', title: 'Команды (commands.md)', layer: 'C', hint: 'Поведение /go /save /ask — движок, в промпт не идёт.' },
	{ slug: 'systems', title: 'Системы (systems.md)', layer: 'C', hint: 'Бой, экономика, время — код, в промпт не идёт.' }
];

const KNOWN_SLUGS = new Set(RULE_FILES.map((f) => f.slug));

// --- Дефолтные выжимки (prompt_core) для засева. Редактируются из админки. ---

const MASTER_CORE = `Ты — Мастер-рассказчик одиночной текстовой ролевой игры в живом эпическом фэнтези. Веди на русском, атмосферной прозой через пять чувств.

Стиль ведения:
- ВСЕГДА второе лицо, настоящее время: «ты видишь…», «ты слышишь…», «перед тобой…». НИКОГДА не веди рассказ в третьем лице и не называй героя по имени как стороннего. Правило не сбрасывается после загрузки — возобновляя игру, сразу продолжай во втором лице.
- Описывай сцену до момента выбора и останавливайся там, где нужно решение игрока.
- NPC отыгрывай характером и мотивацией; речь различай по сословию.

Железные правила:
- НИКОГДА не действуй за игрока: описывай мир, NPC и последствия — активные действия, диалоги, бой и магия остаются за игроком.
- НЕ выдумывай числа (капитал, HP, цены) и факты. Источник истины — блок СОСТОЯНИЕ ниже; механику считает движок.
- НЕ бросай кости и не называй DC — исход придёт от движка. В бою описывай действия врага, а не тайминги («гуль несётся на тебя», не «гуль за 3 секунды не успеет»).
- Последствия подавай нарративом, а не таблицей-счётчиком.
- Мир тёмный и взрослый по дизайну (инквизиция, кровь, культы) — это художественная зрелость.

Формат ответа: сцена → диалоги NPC → действия и последствия → блок статуса в КОНЦЕ каждого ответа:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ [время] (День [X])   📍 [локация]
💰 [капитал] SP   💚 HP [X/Y]   ✦ Сила: [состояние]
⏳ Дедлайны: [название — День X; …]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Дедлайны — ключевые активные таймеры, списком с датами, в КАЖДОМ ответе; если активных нет — строку опусти. Строку статуса не раздувай.`;

const WORLD_CORE = `Тон мира: живой, насыщенный магией мир — магия это сила и чудо, а не наказание. Нет абсолютного добра и зла: есть интересы, амбиции, верность и предательство. Ставки растут вместе с героем (от наёмничьей работы до судьбы городов). Смерть значима, но мир — про подвиг и величие, а не про ежедневное выживание впроголодь; рутину сворачивай в строку и веди к значимому.

Ротация тем (против «одного сюжета»):
- Чередуй сюжетные движки: политика, деньги и гильдии, криминал, закон, вера и инквизиция, социум и личное, война и фронтир, дорога, расследование, магия в миру. Следующая крупная арка — из типа, не использованного в последних 2–3 арках.
- Потолок арканного: истории про Первых / Места Силы / древние артефакты — не чаще ~1 из 4 арок; чаще держи метасюжет фоновым гулом (слух, странность), а не движущей силой. Не своди любой движок к магии (проклятый дом — чаще человеческое преступление; ведьма — знахарка; пропавший груз — контрабанда).
- Чередуй масштаб ставок: личное → местное → региональное → державное.`;

const MAGIC_CORE = `Магия (когда в сцене магия или маг):
- Единый ресурс — Сила (восстановимая). Веди скрыто и грубо состоянием: Полон / Расходует / На исходе / Истощён. Маны нет.
- Два типа магов: черпающие (зависят от Мест Силы, их каст можно сорвать) и своесильные (независимы от места, но резерв конечен).
- Нет фиксированных заклинаний: игрок описывает намерение, ты судишь по трём осям — хватит ли Силы, в рамках ли школы/воображения, удастся ли (мастерство — скрытый бросок). Провал — искажение (частичный эффект / обратный удар / вспышка внимания), а не «ничего».
- Каст тратит и Силу, и выносливость.
- ТЁМНЫЕ ЦЕНЫ держи в уме: обычная магия стоит только Силы. Необратимые дуги (коррупция, деградация воли, распад памяти, годы жизни) поднимай только за по-настоящему переступающие действия, редко и веско, и показывай повествованием (чернеющие вены, холодный взгляд, забытое имя, седина), а не числом. Рутину они не трогают никогда.`;

const RELIGIONS_CORE = `Религия и вера (когда в сцене религия / культ / инквизиция / храм / жрец):
- Основные силы: Церковь Солнца, Орден Луны, тёмные культы; боги вмешиваются в дела смертных скорее косвенно.
- Инквизиция — реальная угроза для магов «не той» школы и тёмных дуг: доносы, проверки, охота за головой. Отыгрывай её давление нарративом, а не объявлением счётчиков.
- Жрецы черпают божественную магию из домена своего бога; легальность школ и культов зависит от региона и господствующей веры.`;

const CREATION_CORE = `Создание новой партии: персонаж уже живёт в мире (есть прошлое-направление, базовое знание мира и причина быть здесь) — не «проснулся без памяти». Старт — момент перемены, не «с нуля».
Потолок старта: способный, но не прокачанный. Магия — только открытая школа по направлению на уровне «Новичок» (редкие школы недоступны). Репутация скромная: нейтрально для «светлого» старта, подозрительный — для тёмного. Хук мягкий, как выбор, а не приказ.`;

const PROGRESSION_MINI = `Развитие и последствия: особенности показывай словами («Опытный переговорщик»), не числами; развитие — через практику и вехи, не по таймеру. Последствия — нарративом (косые взгляды, закрытая дверь, слух об инквизиции); скрытые счётчики и триггеры ведёт движок.`;

const DEFAULT_CORES: Record<string, string> = {
	master: MASTER_CORE,
	world: WORLD_CORE,
	magic: MAGIC_CORE,
	religions: RELIGIONS_CORE,
	creation: CREATION_CORE,
	progression: PROGRESSION_MINI,
	commands: '', // Слой C — в промпт не идёт
	systems: '' //  Слой C — в промпт не идёт
};

/** Резолв каталога бандла rules/ относительно этого модуля (apps/server/src → ../../../rules). */
function bundleDir(): string {
	if (process.env.RULES_DIR) return process.env.RULES_DIR;
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, '../../../rules');
}

/** Контекст сцены для определения триггеров Слоя B. */
export interface SceneTriggerCtx {
	magic: boolean;
	religion: boolean;
}

function detectTriggers(state: GameState, input: string): SceneTriggerCtx {
	const parts: string[] = [input, state.session.current_moment];
	for (const id of state.session.npcs_in_scene) {
		const n = state.npc.find((x) => x.id === id);
		if (n) parts.push(n.core.role, n.core.character, n.core.motivation ?? '');
	}
	const hay = parts.join(' ').toLowerCase();
	const mods = activeModules(state);
	const magic =
		mods.includes('magic') ||
		/\bмаг|колдов|заклин|чар[аыоуе]|аркан|школ[аыуе]|некроман|друид|шаман|чернокниж|ритуал|зель[ея]|артефакт|места?\s*силы|порч[аиу]|проклят/.test(hay);
	const religion =
		mods.includes('faith') ||
		/религ|культ|инквизиц|храм|жрец|жриц|боги|церков|орден\s*луны|орден\s*солнца|молитв|паломн|святил|епископ|монах|еретик|ерес/.test(hay);
	return { magic, religion };
}

/** Вытащить секцию из markdown по ключевому слову в заголовке (для банка завязок Режиссёру). */
function extractSection(full: string, re: RegExp): string {
	const lines = full.split('\n');
	let start = -1;
	let level = 0;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i]!.match(/^(#{1,6})\s+(.*)$/);
		if (m && re.test(m[2]!)) {
			start = i;
			level = m[1]!.length;
			break;
		}
	}
	if (start < 0) return '';
	const out = [lines[start]!];
	for (let i = start + 1; i < lines.length; i++) {
		const m = lines[i]!.match(/^(#{1,6})\s+/);
		if (m && m[1]!.length <= level) break;
		out.push(lines[i]!);
	}
	return out.join('\n').trim();
}

/** Снимок правил для синхронной сборки промпта (читается из кэша RulesStore). */
export interface RuleInjector {
	/** Слой A — операционное ядро Ведущего (master.md) + тон/ротация (world.md) + мини-прогрессия. */
	layerA(): string;
	/** Слой B для нарратора — выдержки по триггерам сцены. */
	narratorExcerpts(state: GameState, input: string): string[];
	/** Слой B для Режиссёра — банк завязок/лор мира при планировании арки. */
	directorContext(): string;
	/** Слой B — ядро создания (только новая игра). */
	creationCore(): string;
}

export class RulesStore implements RuleInjector {
	private cache = new Map<string, RuleRow>();
	constructor(private readonly db: Db) {}

	/** Засев из бандла (если в БД пусто) + загрузка всего в память. */
	async init(): Promise<void> {
		const dir = bundleDir();
		let seeded = 0;
		for (const f of RULE_FILES) {
			let full = '';
			try {
				full = await readFile(resolve(dir, `${f.slug}.md`), 'utf8');
			} catch {
				/* файла нет в бандле — засеем пустым, заполнят из админки */
			}
			const core = DEFAULT_CORES[f.slug] ?? '';
			if (await this.db.seedRule(f.slug, full, core)) seeded++;
		}
		await this.reload();
		if (seeded) console.log(`[rules] засеяно правил из бандла: ${seeded}`);
		console.log(`[rules] загружено правил в память: ${this.cache.size}`);
	}

	/** Перечитать кэш из БД (горячая загрузка после правки). */
	async reload(): Promise<void> {
		const rows = await this.db.getRules();
		this.cache = new Map(rows.map((r) => [r.slug, r]));
	}

	private core(slug: string): string {
		const r = this.cache.get(slug);
		if (!r) return DEFAULT_CORES[slug] ?? '';
		// prompt_core задан — используем его; пуст — деривация из full_text; иначе дефолт.
		return r.prompt_core.trim() || derivePromptCore(r.full_text) || DEFAULT_CORES[slug] || '';
	}

	private full(slug: string): string {
		return this.cache.get(slug)?.full_text ?? '';
	}

	layerA(): string {
		const blocks = [this.core('master'), this.core('world'), this.core('progression')].filter((s) => s.trim());
		return blocks.join('\n\n');
	}

	narratorExcerpts(state: GameState, input: string): string[] {
		const t = detectTriggers(state, input);
		const out: string[] = [];
		if (t.magic) {
			const c = this.core('magic');
			if (c) out.push(c);
		}
		if (t.religion) {
			const c = this.core('religions');
			if (c) out.push(c);
		}
		return out;
	}

	directorContext(): string {
		// Банк завязок / сюжетные движки из world.md (если размечен), иначе ядро мира.
		const section = extractSection(this.full('world'), /движк|завязок|завязк|сюжетн/i);
		return section || this.core('world');
	}

	creationCore(): string {
		return this.core('creation');
	}

	// --- Админ: список / правка / версии / откат ---

	list(): (RuleMeta & { full_text: string; prompt_core: string; version: number; updated_at: string | null })[] {
		const seen = new Set<string>();
		const out: (RuleMeta & { full_text: string; prompt_core: string; version: number; updated_at: string | null })[] = [];
		for (const meta of RULE_FILES) {
			const r = this.cache.get(meta.slug);
			seen.add(meta.slug);
			out.push({
				...meta,
				full_text: r?.full_text ?? '',
				prompt_core: r?.prompt_core ?? '',
				version: r?.version ?? 0,
				updated_at: r?.updated_at ?? null
			});
		}
		// Кастомные правила (добавленные через UI), которых нет в каталоге.
		for (const [slug, r] of this.cache) {
			if (seen.has(slug)) continue;
			out.push({
				slug,
				title: `${slug}.md`,
				layer: 'B',
				hint: 'Пользовательское правило.',
				full_text: r.full_text,
				prompt_core: r.prompt_core,
				version: r.version,
				updated_at: r.updated_at
			});
		}
		return out;
	}

	async save(slug: string, fullText: string, promptCore: string): Promise<RuleRow> {
		const row = await this.db.saveRule(slug, fullText, promptCore);
		this.cache.set(slug, row);
		return row;
	}

	async restore(slug: string, version: number): Promise<RuleRow | null> {
		const v = await this.db.ruleVersion(slug, version);
		if (!v) return null;
		return this.save(slug, v.full_text, v.prompt_core);
	}

	versions(slug: string) {
		return this.db.ruleVersions(slug);
	}

	isKnown(slug: string): boolean {
		return KNOWN_SLUGS.has(slug) || this.cache.has(slug);
	}
}

/** Грубая деривация выжимки из полного текста, когда prompt_core не задан явно.
 *  Берём заголовок + начало содержимого, обрезаем до ~3000 символов (не раздувать промпт). */
export function derivePromptCore(full: string, maxChars = 3000): string {
	const text = full.trim();
	if (!text) return '';
	if (text.length <= maxChars) return text;
	// Режем по границе абзаца ближе к лимиту.
	const slice = text.slice(0, maxChars);
	const cut = slice.lastIndexOf('\n\n');
	return (cut > maxChars * 0.5 ? slice.slice(0, cut) : slice).trim() + '\n…';
}

/** Валидация slug для пользовательских правил. */
export function validRuleSlug(slug: string): boolean {
	return /^[a-z][a-z0-9_-]{1,40}$/.test(slug);
}
