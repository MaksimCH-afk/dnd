import { DEFAULT_MODEL_CONFIG, type AppModelConfig, type LlmRole } from '@rpg/engine';

/** Конфиг app-сервера. Секреты (ключи) только здесь, в клиент не попадают. */
export interface ServerConfig {
	port: number;
	databaseUrl: string;
	corsOrigins: string[];
	referer: string | undefined;
	title: string | undefined;
	embedderModel: string;
	/** Каталог собранного тонкого клиента (apps/web/build). Пусто — не раздавать статику. */
	webDir: string | undefined;
	models: AppModelConfig;
	/** Ключ по умолчанию + переопределения по ролям. */
	keys: {
		default: string | undefined;
		narrator?: string;
		validator?: string;
		director?: string;
		fallback?: string;
	};
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Конфиг моделей: дефолты движка + переопределения из env по ролям.
 *   OPENROUTER_MODEL_NARRATOR / _VALIDATOR / _DIRECTOR / _FALLBACK — основной id
 *   OPENROUTER_MODEL_NARRATOR_ALT и т.п. — альтернатива (опц.)
 * Так можно поставить платного Ведущего, не трогая код.
 */
export function buildModels(): AppModelConfig {
	const cfg = structuredClone(DEFAULT_MODEL_CONFIG);
	const set = (role: keyof AppModelConfig['models'], model?: string, alt?: string) => {
		if (model) cfg.models[role].model = model;
		if (alt) cfg.models[role].alternative = alt;
	};
	set('narrator', process.env.OPENROUTER_MODEL_NARRATOR, process.env.OPENROUTER_MODEL_NARRATOR_ALT);
	set('validator', process.env.OPENROUTER_MODEL_VALIDATOR, process.env.OPENROUTER_MODEL_VALIDATOR_ALT);
	set('director', process.env.OPENROUTER_MODEL_DIRECTOR, process.env.OPENROUTER_MODEL_DIRECTOR_ALT);
	set('fallback_narrator', process.env.OPENROUTER_MODEL_FALLBACK);
	return cfg;
}

export function loadConfig(): ServerConfig {
	const port = Number.parseInt(process.env.PORT ?? '', 10) || 8787;
	const corsOrigins = (process.env.CORS_ORIGINS ?? '*')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return {
		port,
		databaseUrl: process.env.DATABASE_URL ?? 'postgres://rpg:rpg@localhost:5432/rpg',
		corsOrigins,
		referer: process.env.OPENROUTER_REFERER || undefined,
		title: process.env.OPENROUTER_TITLE || undefined,
		embedderModel: process.env.EMBEDDER_MODEL || 'Xenova/bge-m3',
		webDir: process.env.WEB_DIR || undefined,
		models: buildModels(),
		keys: {
			default: process.env.OPENROUTER_API_KEY || undefined,
			...(process.env.OPENROUTER_KEY_NARRATOR ? { narrator: process.env.OPENROUTER_KEY_NARRATOR } : {}),
			...(process.env.OPENROUTER_KEY_VALIDATOR ? { validator: process.env.OPENROUTER_KEY_VALIDATOR } : {}),
			...(process.env.OPENROUTER_KEY_DIRECTOR ? { director: process.env.OPENROUTER_KEY_DIRECTOR } : {}),
			...(process.env.OPENROUTER_KEY_FALLBACK ? { fallback: process.env.OPENROUTER_KEY_FALLBACK } : {})
		}
	};
}

/** Ключ для роли: свой ключ роли (или fallback-ключ для тёмной сцены) → иначе общий. */
export function keyForRole(cfg: ServerConfig, role: LlmRole, preferFallback = false): string | undefined {
	if (role === 'narrator' && preferFallback && cfg.keys.fallback) return cfg.keys.fallback;
	const own = cfg.keys[role as 'narrator' | 'validator' | 'director'];
	return own || cfg.keys.default;
}

// --- Рантайм-переопределения (админ-панель) поверх env-базы ---

type KeyRole = 'default' | 'narrator' | 'validator' | 'director' | 'fallback';
type ModelRoleKey = 'narrator' | 'validator' | 'director' | 'fallback';

/** Что админ может переопределить и сохранить в БД (поверх env). */
export interface ConfigOverrides {
	keys?: Partial<Record<KeyRole, string>>;
	models?: Partial<Record<ModelRoleKey, string>>;
}

export interface ConfigBaseline {
	keys: ServerConfig['keys'];
	models: AppModelConfig;
}

/** Снимок env-базы (до наложения сохранённых переопределений). */
export function snapshotBaseline(cfg: ServerConfig): ConfigBaseline {
	return { keys: { ...cfg.keys }, models: structuredClone(cfg.models) };
}

/** Наложить переопределения на базу и применить к cfg (мутирует cfg.keys/cfg.models). */
export function applyOverrides(cfg: ServerConfig, base: ConfigBaseline, ov: ConfigOverrides): void {
	const keys: ServerConfig['keys'] = { ...base.keys };
	for (const role of ['default', 'narrator', 'validator', 'director', 'fallback'] as KeyRole[]) {
		const v = ov.keys?.[role];
		if (v) keys[role] = v; // непустое значение переопределяет; пустое/отсутствует → env-база
	}
	cfg.keys = keys;

	const models = structuredClone(base.models);
	if (ov.models?.narrator) models.models.narrator.model = ov.models.narrator;
	if (ov.models?.validator) models.models.validator.model = ov.models.validator;
	if (ov.models?.director) models.models.director.model = ov.models.director;
	if (ov.models?.fallback) models.models.fallback_narrator.model = ov.models.fallback;
	cfg.models = models;
}

/** Безопасная для клиента картина конфига: какие ключи заданы (без значений) + модели. */
export function publicConfigView(cfg: ServerConfig, ov: ConfigOverrides) {
	const E = DEFAULT_MODEL_CONFIG.models;
	const opts = (...ids: (string | undefined)[]) => [...new Set(ids.filter((x): x is string => Boolean(x)))];
	return {
		keysSet: {
			default: Boolean(cfg.keys.default),
			narrator: Boolean(cfg.keys.narrator),
			validator: Boolean(cfg.keys.validator),
			director: Boolean(cfg.keys.director),
			fallback: Boolean(cfg.keys.fallback)
		},
		models: {
			narrator: cfg.models.models.narrator.model,
			validator: cfg.models.models.validator.model,
			director: cfg.models.models.director.model,
			fallback: cfg.models.models.fallback_narrator.model
		},
		// Готовые варианты по ролям (основная + альтернативная из дефолтов движка) — для выпадающих списков.
		options: {
			narrator: opts(E.narrator.model, E.narrator.alternative),
			validator: opts(E.validator.model, E.validator.alternative),
			director: opts(E.director.model, E.director.alternative),
			fallback: opts(E.fallback_narrator.model, E.fallback_narrator.alternative)
		},
		// какие именно поля заданы переопределением (чтобы UI показал «из админки» vs «из env»)
		overridden: {
			keys: Object.keys(ov.keys ?? {}).filter((k) => (ov.keys as Record<string, string>)[k]),
			models: Object.keys(ov.models ?? {}).filter((k) => (ov.models as Record<string, string>)[k])
		}
	};
}
