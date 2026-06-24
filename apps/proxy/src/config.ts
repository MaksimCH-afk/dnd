import { DEFAULT_MODEL_CONFIG, type AppModelConfig } from '@rpg/engine';

/** Конфиг прокси из окружения. Игровое состояние тут НЕ хранится. */
export interface ProxyConfig {
	port: number;
	apiKey: string | undefined;
	corsOrigins: string[];
	referer: string | undefined;
	title: string | undefined;
	models: AppModelConfig;
}

const DEFAULT_PORT = 8787;

export function loadConfig(): ProxyConfig {
	const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
	const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	return {
		port,
		apiKey: process.env.OPENROUTER_API_KEY,
		corsOrigins,
		referer: process.env.OPENROUTER_REFERER,
		title: process.env.OPENROUTER_TITLE,
		// Раскладку моделей по ролям держим из движка (единый источник истины).
		// Позже фронт сможет переопределять model в запросе.
		models: DEFAULT_MODEL_CONFIG
	};
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
