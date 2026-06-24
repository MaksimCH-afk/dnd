/**
 * Управление ключами API из фронтенда (требование пользователя): добавить /
 * изменить / сохранить / удалить / проверить. Хранение — localStorage (приложение
 * однопользовательское, self-hosted). Ключ отправляется прокси в каждом запросе;
 * прокси stateless и сам ключи не хранит.
 *
 * Структура с провайдерами — на вырост (пока один: openrouter).
 */

import { browser } from '$app/environment';

export type KeyProvider = 'openrouter';

interface KeyStore {
	openrouter: string;
}

const STORAGE_KEY = 'rpg.keys.v0';

function load(): KeyStore {
	if (!browser) return { openrouter: '' };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { openrouter: '' };
		return { openrouter: '', ...(JSON.parse(raw) as Partial<KeyStore>) };
	} catch {
		return { openrouter: '' };
	}
}

export const keys = $state<KeyStore>(load());

function persist(): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

/** Текущий ключ провайдера (пустая строка, если не задан). */
export function getKey(provider: KeyProvider = 'openrouter'): string {
	return keys[provider] ?? '';
}

export function hasKey(provider: KeyProvider = 'openrouter'): boolean {
	return Boolean(keys[provider]);
}

/** Добавить/изменить/сохранить ключ. */
export function setKey(value: string, provider: KeyProvider = 'openrouter'): void {
	keys[provider] = value.trim();
	persist();
}

/** Удалить ключ. */
export function clearKey(provider: KeyProvider = 'openrouter'): void {
	keys[provider] = '';
	persist();
}
