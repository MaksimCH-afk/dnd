/**
 * Конфиг ролей моделей (ТЗ раздел 6).
 *
 * Назначение модели на роль — значение = OpenRouter model ID. Все игровые
 * подсистемы (бой, экономика, время, репутация …) — детерминированный движок,
 * НЕ вызовы модели, поэтому число LLM-ролей фиксировано.
 */

/** Роли, требующие LLM-вызова. Эмбеддинги — локально (RAG), здесь как роль конфига. */
export type LlmRole = 'narrator' | 'validator' | 'director';

/** Все роли в конфиге, включая фоллбэк и эмбеддер. */
export type ModelRole = LlmRole | 'fallback_narrator' | 'embeddings';

export interface RetryPolicy {
	/** Сколько повторов при rate-limit/недоступности перед фоллбэком. */
	maxRetries: number;
	/** Базовая задержка бэкоффа (мс); экспоненциальный рост. */
	backoffBaseMs: number;
	/** Потолок задержки (мс). */
	backoffMaxMs: number;
}

export interface RoleModelConfig {
	/** OpenRouter model ID (для embeddings — идентификатор локальной модели). */
	model: string;
	/** Альтернативы (по порядку): ручной переключатель + авто-фолбэк при отказе. */
	alternatives?: string[];
	temperature?: number;
	/** Лимит токенов ответа. */
	maxTokens?: number;
}

export interface AppModelConfig {
	models: Record<ModelRole, RoleModelConfig>;
	/** Запасная модель на случай отказа — общая для LLM-ролей. */
	retry: RetryPolicy;
	/**
	 * Контекст фоллбэк-нарратора мал (Venice 33K) → движок жёстко обрезает промпт.
	 * Лимит в токенах для сборки промпта под фоллбэк.
	 */
	fallbackPromptTokenBudget: number;
}

/**
 * Дефолты по ролям (платные модели OpenRouter, выбор игрока). Первый — основной,
 * далее альтернативы по порядку (ручной переключатель + авто-фолбэк). Меняются из
 * админки и сохраняются в БД.
 */
export const DEFAULT_MODEL_CONFIG: AppModelConfig = {
	models: {
		narrator: {
			model: 'qwen/qwen3.6-plus',
			alternatives: ['google/gemini-3.1-pro-preview', 'anthropic/claude-sonnet-4.6'],
			temperature: 0.9,
			maxTokens: 2048
		},
		validator: {
			model: 'deepseek/deepseek-v3.2',
			alternatives: ['xiaomi/mimo-v2-flash'],
			temperature: 0.1,
			maxTokens: 1024
		},
		director: {
			// Редкий вызов (раз в ~6 ходов, между арками) — нужен сильный ризонинг/длинный контекст.
			model: 'google/gemini-3.1-pro-preview',
			alternatives: ['anthropic/claude-sonnet-4.6'],
			temperature: 0.8,
			maxTokens: 1536
		},
		fallback_narrator: {
			// Тёмные сцены при отказе/смягчении основного нарратора.
			model: 'deepseek/deepseek-v3.2',
			alternatives: ['deepseek/deepseek-v4-flash'],
			temperature: 0.9,
			maxTokens: 1536
		},
		embeddings: {
			// Локальный эмбеддер (transformers.js), сменный. Не идёт через прокси.
			model: 'bge-m3',
			alternatives: ['multilingual-e5-large']
		}
	},
	retry: {
		maxRetries: 3,
		backoffBaseMs: 1000,
		backoffMaxMs: 16000
	},
	fallbackPromptTokenBudget: 24000
};

/** Модели, которые НЕЛЬЗЯ использовать на игровом тексте (логируют промпты). */
export const FORBIDDEN_MODELS: readonly string[] = [
	'openrouter/owl-alpha',
	'poolside/laguna-m.1:free'
];

export function isLlmRole(role: string): role is LlmRole {
	return role === 'narrator' || role === 'validator' || role === 'director';
}
