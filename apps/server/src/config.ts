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
 * Конфиг моделей: дефолты движка + опц. переопределение основной модели из env
 * (OPENROUTER_MODEL_NARRATOR / _VALIDATOR / _DIRECTOR / _FALLBACK). Полные списки
 * (дефолт + альтернативы) редактируются из админки и хранятся в БД.
 */
export function buildModels(): AppModelConfig {
	const cfg = structuredClone(DEFAULT_MODEL_CONFIG);
	const set = (role: keyof AppModelConfig['models'], model?: string) => {
		if (model) cfg.models[role].model = model;
	};
	set('narrator', process.env.OPENROUTER_MODEL_NARRATOR);
	set('validator', process.env.OPENROUTER_MODEL_VALIDATOR);
	set('director', process.env.OPENROUTER_MODEL_DIRECTOR);
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

/** Что админ может переопределить и сохранить в БД (поверх env).
 *  models[role] — список id (первый = основной, далее альтернативы по порядку). */
export interface ConfigOverrides {
	keys?: Partial<Record<KeyRole, string>>;
	models?: Partial<Record<ModelRoleKey, string[]>>;
}

const MODEL_ROLE_MAP: Record<ModelRoleKey, 'narrator' | 'validator' | 'director' | 'fallback_narrator'> = {
	narrator: 'narrator',
	validator: 'validator',
	director: 'director',
	fallback: 'fallback_narrator'
};

/** Нормализовать список моделей (строка или массив → массив непустых строк). */
export function toModelList(v: unknown): string[] {
	const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
	return arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim());
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
	for (const role of ['narrator', 'validator', 'director', 'fallback'] as ModelRoleKey[]) {
		const list = toModelList(ov.models?.[role]);
		if (list.length) {
			const m = models.models[MODEL_ROLE_MAP[role]];
			m.model = list[0]!;
			m.alternatives = list.slice(1);
		}
	}
	cfg.models = models;
}

/** Безопасная для клиента картина конфига: какие ключи заданы (без значений) + модели. */
export function publicConfigView(cfg: ServerConfig, ov: ConfigOverrides) {
	const E = DEFAULT_MODEL_CONFIG.models;
	const list = (m: { model: string; alternatives?: string[] }) => [m.model, ...(m.alternatives ?? [])];
	const M = cfg.models.models;
	return {
		keysSet: {
			default: Boolean(cfg.keys.default),
			narrator: Boolean(cfg.keys.narrator),
			validator: Boolean(cfg.keys.validator),
			director: Boolean(cfg.keys.director),
			fallback: Boolean(cfg.keys.fallback)
		},
		// Текущие списки по ролям (первый — основной, далее альтернативы).
		models: {
			narrator: list(M.narrator),
			validator: list(M.validator),
			director: list(M.director),
			fallback: list(M.fallback_narrator)
		},
		// Дефолтные списки (для кнопки «вернуть к дефолту»).
		defaults: {
			narrator: list(E.narrator),
			validator: list(E.validator),
			director: list(E.director),
			fallback: list(E.fallback_narrator)
		},
		overridden: {
			keys: Object.keys(ov.keys ?? {}).filter((k) => (ov.keys as Record<string, string>)[k]),
			models: Object.keys(ov.models ?? {}).filter((k) => toModelList((ov.models as Record<string, unknown>)[k]).length)
		}
	};
}
