import { DEFAULT_MODEL_CONFIG, type AppModelConfig, type LlmRole } from '@rpg/engine';

/** Конфиг app-сервера. Секреты (ключи) только здесь, в клиент не попадают. */
export interface ServerConfig {
	port: number;
	databaseUrl: string;
	corsOrigins: string[];
	referer: string | undefined;
	title: string | undefined;
	embedderModel: string;
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
		models: DEFAULT_MODEL_CONFIG,
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
