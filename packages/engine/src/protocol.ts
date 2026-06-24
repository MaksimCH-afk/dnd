/**
 * Контракт между PWA (движок) и тонким бэкендом-прокси (ТЗ раздел 18.6).
 *
 * Фронт держит движок и состояние; к бэкенду — ТОЛЬКО за LLM и эмбеддингами.
 * Бэкенд stateless: подставляет ключ, ретраи/фоллбэк, в метаданных — какая
 * модель реально ответила.
 */

import type { LlmRole } from './config';

/** Сообщение в OpenRouter-совместимом формате. */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
}

/** Тело запроса `POST /llm/{role}`. Промпт уже собран движком. */
export interface LlmRequest {
	messages: ChatMessage[];
	/** Переопределение модели (иначе бэкенд берёт из конфига роли). */
	model?: string;
	temperature?: number;
	maxTokens?: number;
	/** Tool-схема (для нарратора — propose_ops). */
	tools?: unknown;
	/** Запросить переключение на фоллбэк-профиль (тёмная сцена). */
	preferFallback?: boolean;
}

/** События SSE-потока от `POST /llm/{role}`. */
export type LlmStreamEvent =
	/** Кусок прозы для эффекта письма. */
	| { type: 'delta'; text: string }
	/** Сырой tool-call от модели (нормализуется валидатором позже). */
	| { type: 'tool_call'; raw: unknown }
	/** Финал: метаданные о том, какая модель ответила. */
	| { type: 'done'; meta: LlmResponseMeta }
	/** Ошибка генерации (после исчерпания ретраев/фоллбэка). */
	| { type: 'error'; message: string; code?: string };

export interface LlmResponseMeta {
	role: LlmRole;
	/** Модель, которая РЕАЛЬНО ответила (могла быть фоллбэк/альтернатива). */
	model: string;
	usedFallback: boolean;
	attempts: number;
	finishReason?: string;
	usage?: { promptTokens?: number; completionTokens?: number };
}

/** Ответ `GET /health`: доступность + раскладка моделей по ролям. */
export interface HealthResponse {
	ok: boolean;
	hasApiKey: boolean;
	models: Record<string, { model: string; alternative?: string }>;
	version: string;
}
