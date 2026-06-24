/**
 * Настройки тонкого клиента (hosted): адрес сервера, тема, размер текста.
 * Ключи/модели/RAG/git — на сервере; в клиенте их нет.
 */
import { browser } from '$app/environment';

export interface Settings {
	serverUrl: string;
	theme: 'dark' | 'light';
	textScale: number;
	onboarded: boolean;
}

const STORAGE_KEY = 'rpg.settings.v2';

const DEFAULTS: Settings = {
	serverUrl: 'http://localhost:8787',
	theme: 'dark',
	textScale: 1,
	onboarded: false
};

function load(): Settings {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
	} catch {
		return { ...DEFAULTS };
	}
}

export const settings = $state<Settings>(load());

export function applySettings(): void {
	if (!browser) return;
	document.documentElement.dataset.theme = settings.theme;
	document.documentElement.style.setProperty('--text-scale', String(settings.textScale));
}

export function saveSettings(): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	applySettings();
}
