/**
 * Пользовательские настройки оболочки (фаза 0): адрес прокси, тема, размер текста.
 * Персист в localStorage. Игровой канон тут НЕ хранится (он в git-репо — фаза 1).
 */

import { browser } from '$app/environment';

export interface Settings {
	proxyUrl: string;
	theme: 'dark' | 'light';
	textScale: number;
	reducedMotion: boolean;
}

const STORAGE_KEY = 'rpg.settings.v0';

const DEFAULTS: Settings = {
	proxyUrl: 'http://localhost:8787',
	theme: 'dark',
	textScale: 1,
	reducedMotion: false
};

function load(): Settings {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
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
