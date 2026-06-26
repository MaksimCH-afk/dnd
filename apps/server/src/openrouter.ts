import type { ChatMessage, LlmRole, LlmStreamEvent, LlmResponseMeta } from '@rpg/engine';
import { OPENROUTER_URL, keyForRole, type ServerConfig } from './config';

export interface CallOpts {
	temperature?: number;
	maxTokens?: number;
	tools?: unknown;
	preferFallback?: boolean;
	signal?: AbortSignal;
}

function isRetryable(status: number): boolean {
	return status === 408 || status === 409 || status === 429 || status >= 500;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Таймауты против зависших апстримов (иначе ход «висит» вечно и сервер падает по healthcheck).
const CONNECT_TIMEOUT_MS = 45000; // время до первого ответа модели
const STREAM_IDLE_MS = 90000; // пауза без новых токенов в стриме → обрыв

function candidateModels(cfg: ServerConfig, role: LlmRole, preferFallback: boolean): string[] {
	const roleCfg = cfg.models.models[role];
	const list: string[] = [roleCfg.model, ...(roleCfg.alternatives ?? [])];
	if (role === 'narrator') {
		const fb = cfg.models.models.fallback_narrator.model;
		if (fb) preferFallback ? list.unshift(fb) : list.push(fb);
	}
	return [...new Set(list)];
}

/** Стрим ответа роли напрямую из OpenRouter (ключ — серверный, по роли). */
export async function* streamCompletion(
	cfg: ServerConfig,
	role: LlmRole,
	messages: ChatMessage[],
	opts: CallOpts = {}
): AsyncGenerator<LlmStreamEvent> {
	const apiKey = keyForRole(cfg, role, opts.preferFallback);
	if (!apiKey) {
		yield { type: 'error', message: 'нет ключа OpenRouter в конфиге сервера', code: 'no_key' };
		return;
	}
	const roleCfg = cfg.models.models[role];
	const models = candidateModels(cfg, role, opts.preferFallback ?? false);
	const { maxRetries, backoffBaseMs, backoffMaxMs } = cfg.models.retry;
	const callerSignal = opts.signal;

	let usedModel = '';
	let usedFallback = false;
	let attempts = 0;
	let res: Response | null = null;
	let streamCtrl: AbortController | null = null;
	let lastErr = 'неизвестная ошибка';

	outer: for (const model of models) {
		const isFallback = model === cfg.models.models.fallback_narrator.model;
		for (let r = 0; r <= maxRetries; r++) {
			attempts++;
			let retryAfterMs = 0;
			// Контроллер на попытку: обрывается по таймауту соединения или сигналу вызывающего.
			const ctrl = new AbortController();
			const onCallerAbort = () => ctrl.abort();
			if (callerSignal) {
				if (callerSignal.aborted) return;
				callerSignal.addEventListener('abort', onCallerAbort);
			}
			const connectTimer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
			try {
				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				};
				if (cfg.referer) headers['HTTP-Referer'] = cfg.referer;
				if (cfg.title) headers['X-Title'] = cfg.title;
				const body = JSON.stringify({
					model,
					messages,
					stream: true,
					stream_options: { include_usage: true },
					temperature: opts.temperature ?? roleCfg.temperature,
					max_tokens: opts.maxTokens ?? roleCfg.maxTokens,
					...(opts.tools ? { tools: opts.tools } : {})
				});
				const resp = await fetch(OPENROUTER_URL, { method: 'POST', headers, body, signal: ctrl.signal });
				clearTimeout(connectTimer);
				if (resp.ok && resp.body) {
					res = resp;
					streamCtrl = ctrl; // оставляем для idle-таймаута стрима
					usedModel = model;
					usedFallback = isFallback;
					break outer;
				}
				lastErr = `HTTP ${resp.status} (${model})`;
				// При 429 уважаем Retry-After (сек) — пережидаем лимит free-моделей.
				if (resp.status === 429) {
					const ra = Number.parseInt(resp.headers.get('retry-after') ?? '', 10);
					if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 30000);
				}
				await resp.text().catch(() => undefined);
				if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
				if (!isRetryable(resp.status)) break;
			} catch (err) {
				clearTimeout(connectTimer);
				if (callerSignal?.aborted) {
					callerSignal.removeEventListener('abort', onCallerAbort);
					return;
				}
				if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
				lastErr = `сеть/таймаут: ${(err as Error).message} (${model})`;
			}
			if (r < maxRetries) await sleep(Math.max(retryAfterMs, Math.min(backoffBaseMs * 2 ** r, backoffMaxMs)));
		}
	}

	if (!res) {
		yield { type: 'error', message: lastErr, code: 'upstream' };
		return;
	}

	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let finishReason: string | undefined;
	let usage: LlmResponseMeta['usage'];
	// Idle-таймаут стрима: если токены перестали идти — обрываем, отдаём, что успели.
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	const resetIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => streamCtrl?.abort(), STREAM_IDLE_MS);
	};
	if (callerSignal) callerSignal.addEventListener('abort', () => streamCtrl?.abort());
	resetIdle();

	try {
		while (true) {
			const { done, value } = await reader.read();
			resetIdle();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let nl: number;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
				const data = line.slice(5).trim();
				if (data === '[DONE]') break;
				let json: any;
				try {
					json = JSON.parse(data);
				} catch {
					continue;
				}
				const choice = json.choices?.[0];
				const delta = choice?.delta;
				if (typeof delta?.content === 'string' && delta.content.length) {
					yield { type: 'delta', text: delta.content };
				}
				if (Array.isArray(delta?.tool_calls)) {
					for (const tc of delta.tool_calls) yield { type: 'tool_call', raw: tc };
				}
				if (choice?.finish_reason) finishReason = choice.finish_reason;
				if (json.usage) {
					usage = { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens };
				}
			}
		}
	} catch {
		// Обрыв/idle-таймаут стрима — не валим ход: отдаём накопленное и завершаем мета-событием.
	} finally {
		if (idleTimer) clearTimeout(idleTimer);
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

/** Накопить всю прозу роли (для неблокирующих ролей: валидатор/режиссёр). */
export async function complete(cfg: ServerConfig, role: LlmRole, messages: ChatMessage[], opts: CallOpts = {}): Promise<string> {
	let out = '';
	for await (const ev of streamCompletion(cfg, role, messages, opts)) {
		if (ev.type === 'delta') out += ev.text;
	}
	return out;
}

/** Как complete(), но возвращает и upstream-ошибку/модель (для диагностики, напр. импорта). */
export async function completeDetailed(
	cfg: ServerConfig,
	role: LlmRole,
	messages: ChatMessage[],
	opts: CallOpts = {}
): Promise<{ text: string; error?: string; model?: string }> {
	let text = '';
	let error: string | undefined;
	let model: string | undefined;
	for await (const ev of streamCompletion(cfg, role, messages, opts)) {
		if (ev.type === 'delta') text += ev.text;
		else if (ev.type === 'error') error = ev.message;
		else if (ev.type === 'done') model = ev.meta.model;
	}
	return { text, ...(error ? { error } : {}), ...(model ? { model } : {}) };
}
