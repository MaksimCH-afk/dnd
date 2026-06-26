/**
 * Единый вход на сайт (один пользователь). Токен сессии хранится в localStorage и
 * шлётся в каждом запросе к серверу; учётка (логин+пароль) — в БД сервера.
 */
import { browser } from '$app/environment';
import { settings } from './settings.svelte';
import { authApi, setApiToken, setUnauthorizedHandler } from './api';

const TOKEN_KEY = 'rpg.auth.token';
const REMEMBER_KEY = 'rpg.auth.remember';

export function loadRemember(): { user: string; password: string } | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(REMEMBER_KEY);
		return raw ? (JSON.parse(raw) as { user: string; password: string }) : null;
	} catch {
		return null;
	}
}
function saveRemember(user: string, password: string): void {
	if (!browser) return;
	try {
		localStorage.setItem(REMEMBER_KEY, JSON.stringify({ user, password }));
	} catch {
		/* ignore */
	}
}
function clearRemember(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(REMEMBER_KEY);
	} catch {
		/* ignore */
	}
}

export const auth = $state<{ ready: boolean; authed: boolean; configured: boolean; user: string }>({
	ready: false,
	authed: false,
	configured: false,
	user: ''
});

function loadToken(): string {
	if (!browser) return '';
	try {
		return localStorage.getItem(TOKEN_KEY) ?? '';
	} catch {
		return '';
	}
}
function saveToken(t: string): void {
	if (!browser) return;
	try {
		t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
	} catch {
		/* ignore */
	}
	setApiToken(t);
}

/** Инициализация при старте: узнать, заведена ли учётка, и проверить сохранённый токен. */
export async function initAuth(): Promise<void> {
	setUnauthorizedHandler(() => {
		auth.authed = false;
	});
	const token = loadToken();
	setApiToken(token);
	try {
		const s = await authApi.status(settings.serverUrl);
		auth.configured = s.configured;
	} catch {
		auth.configured = false;
	}
	if (token && auth.configured) {
		// Проверяем валидность токена обращением к защищённому /health.
		try {
			const r = await fetch(`${(settings.serverUrl || '').replace(/\/+$/, '')}/health`, {
				headers: { 'X-Auth-Token': token }
			});
			auth.authed = r.ok;
			if (!r.ok) saveToken('');
		} catch {
			auth.authed = false;
		}
	}
	// Токен протух (перезапуск сервера), но есть сохранённый вход — авто-логин.
	if (!auth.authed && auth.configured) {
		const r = loadRemember();
		if (r?.user && r?.password) {
			try {
				await login(r.user, r.password, true);
			} catch {
				clearRemember(); // данные больше не подходят
			}
		}
	}
	auth.ready = true;
}

export async function login(user: string, password: string, remember = false): Promise<void> {
	const r = await authApi.login(settings.serverUrl, user, password);
	saveToken(r.token);
	auth.user = r.user;
	auth.configured = true;
	auth.authed = true;
	remember ? saveRemember(user, password) : clearRemember();
}

export async function setupAuth(user: string, password: string, remember = false): Promise<void> {
	const r = await authApi.setup(settings.serverUrl, user, password);
	saveToken(r.token);
	auth.user = r.user;
	auth.configured = true;
	auth.authed = true;
	remember ? saveRemember(user, password) : clearRemember();
}

export async function logout(): Promise<void> {
	await authApi.logout(settings.serverUrl);
	saveToken('');
	clearRemember();
	auth.authed = false;
}
