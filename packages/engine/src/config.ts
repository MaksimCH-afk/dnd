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
	/** Альтернатива/ручной переключатель (богаче/тяжелее модель). */
	alternative?: string;
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
 * Дефолты из ТЗ раздела 6. Free-модели OpenRouter, где возможно.
 * Контексты: Qwen 262K, Super/Ultra 1M, Hermes 131K, Venice 33K.
 */
export const DEFAULT_MODEL_CONFIG: AppModelConfig = {
	models: {
		narrator: {
			model: 'qwen/qwen3-next-80b-a3b-instruct:free',
			alternative: 'nousresearch/hermes-3-llama-3.1-405b:free',
			temperature: 0.9,
			maxTokens: 2048
		},
		validator: {
			model: 'google/gemma-4-31b-it:free',
			alternative: 'openai/gpt-oss-120b:free',
			temperature: 0.1,
			maxTokens: 1024
		},
		director: {
			model: 'nvidia/nemotron-3-super-120b-a12b:free',
			alternative: 'nvidia/nemotron-3-ultra-550b-a55b:free',
			temperature: 0.8,
			maxTokens: 1536
		},
		fallback_narrator: {
			// Профиль для тёмных сцен при отказе основной модели. Контекст 33K.
			model: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
			temperature: 0.9,
			maxTokens: 1536
		},
		embeddings: {
			// Локальный эмбеддер (transformers.js), сменный. Не идёт через прокси.
			model: 'bge-m3',
			alternative: 'multilingual-e5-large'
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
