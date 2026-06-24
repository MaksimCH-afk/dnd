/**
 * Клиент к бэкенду-прокси (ТЗ 18.6). Фронт собирает промпт, прокси добавляет ключ.
 * Здесь — только транспорт: POST /llm/{role}, парсинг SSE → события движка.
 */

import type {
	ChatMessage,
	HealthResponse,
	LlmRequest,
	LlmRole,
	LlmStreamEvent,
	VerifyKeyResponse
} from '@rpg/engine';
import { getKey } from './keys.svelte';

export interface StreamHandlers {
	onDelta?: (text: string) => void;
	onToolCall?: (raw: unknown) => void;
	onDone?: (event: Extract<LlmStreamEvent, { type: 'done' }>) => void;
	onError?: (event: Extract<LlmStreamEvent, { type: 'error' }>) => void;
}

export async function checkHealth(proxyUrl: string, signal?: AbortSignal): Promise<HealthResponse> {
	const res = await fetch(`${proxyUrl}/health`, { signal });
	if (!res.ok) throw new Error(`health ${res.status}`);
	return (await res.json()) as HealthResponse;
}

/** Проверка ключа OpenRouter через прокси (`POST /verify`). */
export async function verifyKey(
	proxyUrl: string,
	apiKey: string,
	signal?: AbortSignal
): Promise<VerifyKeyResponse> {
	const res = await fetch(`${proxyUrl}/verify`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiKey }),
		signal
	});
	if (!res.ok) return { ok: false, error: `прокси ответил ${res.status}` };
	return (await res.json()) as VerifyKeyResponse;
}

export interface StreamOptions extends Omit<LlmRequest, 'messages'> {
	signal?: AbortSignal;
}

/**
 * Стримит ответ роли. Возвращает накопленный текст прозы по завершении.
 * Бросает только при сетевой ошибке открытия соединения; ошибки апстрима
 * приходят событием onError.
 */
export async function streamLlm(
	proxyUrl: string,
	role: LlmRole,
	messages: ChatMessage[],
	handlers: StreamHandlers,
	opts: StreamOptions = {}
): Promise<string> {
	const { signal, ...rest } = opts;
	// Ключ из стора фронтенда (если в opts не передан явно).
	const apiKey = rest.apiKey ?? (getKey('openrouter') || undefined);
	const body: LlmRequest = { messages, ...rest, ...(apiKey ? { apiKey } : {}) };

	const res = await fetch(`${proxyUrl}/llm/${role}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal
	});

	if (!res.ok || !res.body) {
		const msg = `прокси ответил ${res.status}`;
		handlers.onError?.({ type: 'error', message: msg });
		throw new Error(msg);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let prose = '';

	const dispatch = (event: LlmStreamEvent) => {
		switch (event.type) {
			case 'delta':
				prose += event.text;
				handlers.onDelta?.(event.text);
				break;
			case 'tool_call':
				handlers.onToolCall?.(event.raw);
				break;
			case 'done':
				handlers.onDone?.(event);
				break;
			case 'error':
				handlers.onError?.(event);
				break;
		}
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let nl: number;
		while ((nl = buffer.indexOf('\n\n')) !== -1) {
			const frame = buffer.slice(0, nl);
			buffer = buffer.slice(nl + 2);
			for (const line of frame.split('\n')) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data:')) continue;
				const data = trimmed.slice(5).trim();
				if (!data) continue;
				try {
					dispatch(JSON.parse(data) as LlmStreamEvent);
				} catch {
					/* пропускаем неполный кадр */
				}
			}
		}
	}

	return prose;
}
