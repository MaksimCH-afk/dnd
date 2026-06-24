/**
 * Управление ключами API из фронтенда. Поддержаны РАЗНЫЕ ключи на роль модели
 * (Ведущий/Валидатор/Режиссёр/Фоллбэк/Роутер тёмных сцен/NPC-спавн) + общий ключ
 * по умолчанию (используется, если у роли свой ключ не задан) + git-токен.
 *
 * Хранение — localStorage (приложение однопользовательское). Ключ роли шлётся
 * прокси в каждом запросе; прокси stateless и сам ключи не хранит.
 */

import { browser } from '$app/environment';

/** Роли, которым можно назначить отдельный ключ. */
export type KeyRole = 'narrator' | 'validator' | 'director' | 'fallback' | 'dark_router' | 'npc_spawn';

/** Подписи ролей для UI (по порядку отображения). */
export const KEY_ROLES: { role: KeyRole; label: string; hint: string }[] = [
	{ role: 'narrator', label: 'Ведущий', hint: 'основной рассказчик каждого хода' },
	{ role: 'validator', label: 'Валидатор', hint: 'проверка утечек знания (если включён)' },
	{ role: 'director', label: 'Режиссёр', hint: 'повороты сюжета между арками' },
	{ role: 'fallback', label: 'Фоллбэк (тёмные сцены)', hint: 'запасной профиль для тёмных сцен' },
	{ role: 'dark_router', label: 'Роутер тёмных сцен', hint: 'классификатор «темноты» (опционально)' },
	{ role: 'npc_spawn', label: 'NPC-спавн', hint: 'микромодель генерации NPC (опционально)' }
];

const EMPTY_ROLES: Record<KeyRole, string> = {
	narrator: '',
	validator: '',
	director: '',
	fallback: '',
	dark_router: '',
	npc_spawn: ''
};

export type KeyProvider = 'openrouter' | 'git';

interface KeyStore {
	/** Общий ключ OpenRouter — используется, если у роли свой ключ не задан. */
	openrouter: string;
	/** Токен git (GitHub PAT). */
	git: string;
	/** Ключи по ролям (пусто → берётся общий openrouter). */
	roles: Record<KeyRole, string>;
}

const STORAGE_KEY = 'rpg.keys.v1';
const LEGACY_KEY = 'rpg.keys.v0';

function load(): KeyStore {
	const base: KeyStore = { openrouter: '', git: '', roles: { ...EMPTY_ROLES } };
	if (!browser) return base;
	try {
		const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
		if (!raw) return base;
		const parsed = JSON.parse(raw) as Partial<KeyStore>;
		return {
			openrouter: parsed.openrouter ?? '',
			git: parsed.git ?? '',
			roles: { ...EMPTY_ROLES, ...(parsed.roles ?? {}) }
		};
	} catch {
		return base;
	}
}

export const keys = $state<KeyStore>(load());

function persist(): void {
	if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(keys)));
}

// --- Общий ключ / git (совместимость) ---

export function getKey(provider: KeyProvider = 'openrouter'): string {
	return keys[provider] ?? '';
}
export function hasKey(provider: KeyProvider = 'openrouter'): boolean {
	return Boolean(keys[provider]);
}
export function setKey(value: string, provider: KeyProvider = 'openrouter'): void {
	keys[provider] = value.trim();
	persist();
}
export function clearKey(provider: KeyProvider = 'openrouter'): void {
	keys[provider] = '';
	persist();
}

// --- Ключи по ролям ---

/** Ключ для роли: свой ключ роли, иначе общий openrouter. */
export function getRoleKey(role: KeyRole): string {
	return (keys.roles[role] || '').trim() || (keys.openrouter || '').trim();
}
export function setRoleKey(role: KeyRole, value: string): void {
	keys.roles[role] = value.trim();
	persist();
}
export function clearRoleKey(role: KeyRole): void {
	keys.roles[role] = '';
	persist();
}
