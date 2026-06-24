import {
	isLlmRole,
	type LlmRequest,
	type LlmRole,
	type LlmStreamEvent,
	type LlmResponseMeta
} from '@rpg/engine';
import { OPENROUTER_URL, type ProxyConfig } from './config';

/** Коды ошибок, на которые имеет смысл повторить запрос. */
function isRetryable(status: number): boolean {
	return status === 408 || status === 409 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Список моделей-кандидатов по роли (по порядку попыток):
 * основная → альтернатива → (для нарратора) фоллбэк-профиль.
 * При preferFallback фоллбэк ставится первым.
 */
function candidateModels(cfg: ProxyConfig, role: LlmRole, req: LlmRequest): string[] {
	const roleCfg = cfg.models.models[role];
	const list: string[] = [];
	if (req.model) list.push(req.model);
	if (roleCfg.model) list.push(roleCfg.model);
	if (roleCfg.alternative) list.push(roleCfg.alternative);
	if (role === 'narrator') {
		const fb = cfg.models.models.fallback_narrator.model;
		if (fb) {
			if (req.preferFallback) list.unshift(fb);
			else list.push(fb);
		}
	}
	// Уникализируем, сохраняя порядок.
	return [...new Set(list)];
}

interface AttemptResult {
	response: Response;
	model: string;
}

/** Проверка валидности ключа: список моделей OpenRouter. */
export async function verifyKey(
	apiKey: string,
	signal?: AbortSignal
): Promise<{ ok: boolean; modelCount?: number; error?: string }> {
	if (!apiKey) return { ok: false, error: 'пустой ключ' };
	try {
		const res = await fetch('https://openrouter.ai/api/v1/models', {
			headers: { Authorization: `Bearer ${apiKey}` },
			...(signal ? { signal } : {})
		});
		if (res.status === 401 || res.status === 403) {
			return { ok: false, error: 'ключ отклонён (401/403)' };
		}
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
		const data = (await res.json()) as { data?: unknown[] };
		return { ok: true, modelCount: Array.isArray(data.data) ? data.data.length : undefined };
	} catch (err) {
		return { ok: false, error: `сеть: ${(err as Error).message}` };
	}
}

/**
 * Перебирает кандидатов с экспоненциальным бэкоффом. Возвращает первый
 * успешно открытый поток или бросает с агрегированной причиной.
 */
async function openStream(
	cfg: ProxyConfig,
	role: LlmRole,
	req: LlmRequest,
	apiKey: string,
	signal: AbortSignal,
	onAttempt: (n: number, model: string, fallback: boolean) => void
): Promise<AttemptResult> {
	const models = candidateModels(cfg, role, req);
	const roleCfg = cfg.models.models[role];
	const { maxRetries, backoffBaseMs, backoffMaxMs } = cfg.models.retry;
	let attempt = 0;
	let lastErr = 'неизвестная ошибка';

	for (let mi = 0; mi < models.length; mi++) {
		const model = models[mi]!;
		const isFallback = model === cfg.models.models.fallback_narrator.model;
		for (let r = 0; r <= maxRetries; r++) {
			attempt++;
			onAttempt(attempt, model, isFallback);
			try {
				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				};
				if (cfg.referer) headers['HTTP-Referer'] = cfg.referer;
				if (cfg.title) headers['X-Title'] = cfg.title;

				const body = JSON.stringify({
					model,
					messages: req.messages,
					stream: true,
					stream_options: { include_usage: true },
					temperature: req.temperature ?? roleCfg.temperature,
					max_tokens: req.maxTokens ?? roleCfg.maxTokens,
					...(req.tools ? { tools: req.tools } : {})
				});

				const res = await fetch(OPENROUTER_URL, { method: 'POST', headers, body, signal });

				if (res.ok && res.body) return { response: res, model };

				lastErr = `HTTP ${res.status} ${res.statusText} (${model})`;
				if (!isRetryable(res.status)) break; // к следующей модели

				// читаем тело для лога и освобождаем соединение
				await res.text().catch(() => undefined);
			} catch (err) {
				if (signal.aborted) throw new Error('aborted');
				lastErr = `сеть: ${(err as Error).message} (${model})`;
			}

			if (r < maxRetries) {
				const delay = Math.min(backoffBaseMs * 2 ** r, backoffMaxMs);
				await sleep(delay);
			}
		}
	}
	throw new Error(lastErr);
}

/** Парсит OpenRouter SSE и эмитит нормализованные события движка. */
export async function* streamCompletion(
	cfg: ProxyConfig,
	roleStr: string,
	req: LlmRequest,
	signal: AbortSignal
): AsyncGenerator<LlmStreamEvent> {
	if (!isLlmRole(roleStr)) {
		yield { type: 'error', message: `неизвестная роль: ${roleStr}`, code: 'bad_role' };
		return;
	}
	// Ключ приходит из фронтенда (управляется в UI); env — опциональный сид.
	const apiKey = req.apiKey ?? cfg.apiKey;
	if (!apiKey) {
		yield {
			type: 'error',
			message: 'нет ключа OpenRouter: добавьте ключ в настройках приложения',
			code: 'no_key'
		};
		return;
	}
	const role: LlmRole = roleStr;

	let usedModel = '';
	let usedFallback = false;
	let attempts = 0;

	let opened: AttemptResult;
	try {
		opened = await openStream(cfg, role, req, apiKey, signal, (n, model, fb) => {
			attempts = n;
			usedModel = model;
			usedFallback = fb;
		});
	} catch (err) {
		yield { type: 'error', message: (err as Error).message, code: 'upstream' };
		return;
	}

	const reader = opened.response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let finishReason: string | undefined;
	let usage: LlmResponseMeta['usage'];

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let nl: number;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!line || line.startsWith(':')) continue; // keep-alive/комментарий
				if (!line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (data === '[DONE]') {
					buffer = '';
					break;
				}
				let json: any;
				try {
					json = JSON.parse(data);
				} catch {
					continue;
				}
				const choice = json.choices?.[0];
				const delta = choice?.delta;
				if (typeof delta?.content === 'string' && delta.content.length > 0) {
					yield { type: 'delta', text: delta.content };
				}
				if (Array.isArray(delta?.tool_calls)) {
					for (const tc of delta.tool_calls) {
						yield { type: 'tool_call', raw: tc };
					}
				}
				if (choice?.finish_reason) finishReason = choice.finish_reason;
				if (json.usage) {
					usage = {
						promptTokens: json.usage.prompt_tokens,
						completionTokens: json.usage.completion_tokens
					};
				}
			}
		}
	} catch (err) {
		if (!signal.aborted) {
			yield { type: 'error', message: `обрыв потока: ${(err as Error).message}`, code: 'stream' };
			return;
		}
	} finally {
		reader.releaseLock();
	}

	const meta: LlmResponseMeta = {
		role,
		model: usedModel,
		usedFallback,
		attempts,
		...(finishReason ? { finishReason } : {}),
		...(usage ? { usage } : {})
	};
	yield { type: 'done', meta };
}
