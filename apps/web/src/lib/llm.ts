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
import { getRoleKey, type KeyRole } from './keys.svelte';
import { logEvent } from './logbus.svelte';

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
	// Ключ выбирается по роли (тёмная сцена у Ведущего → ключ фоллбэка).
	const keyRole: KeyRole = role === 'narrator' && rest.preferFallback ? 'fallback' : (role as KeyRole);
	const apiKey = rest.apiKey ?? (getRoleKey(keyRole) || undefined);
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
	const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
	const latency = () => Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);

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
				// llm_call (раздел 22): какая модель реально ответила, фоллбэк, токены, латентность.
				logEvent('llm_call', {
					role,
					model: event.meta.model,
					usedFallback: event.meta.usedFallback,
					attempts: event.meta.attempts,
					finishReason: event.meta.finishReason,
					usage: event.meta.usage,
					latency_ms: latency(),
					prompt_chars: messages.reduce((n, m) => n + m.content.length, 0)
				});
				handlers.onDone?.(event);
				break;
			case 'error':
				logEvent('llm_call', { role, error: event.message, code: event.code, latency_ms: latency() }, 'warn');
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
