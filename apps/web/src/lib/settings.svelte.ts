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
	/** Локальный RAG-поиск (transformers.js). Тяжёлая модель — по согласию. */
	ragEnabled: boolean;
	embedderModel: string;
	/** Git-синхронизация канона (ТЗ §15, кросс-девайс). */
	gitEnabled: boolean;
	gitRepoUrl: string;
	gitBranch: string;
	/** LLM-валидатор утечек знания (доп. вызов модели на ход). */
	validatorEnabled: boolean;
	/** Пройден ли первый запуск (онбординг). */
	onboarded: boolean;
	/** Уровень детализации логов (раздел 22): info по умолчанию. */
	logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

const STORAGE_KEY = 'rpg.settings.v0';

const DEFAULTS: Settings = {
	proxyUrl: 'http://localhost:8787',
	theme: 'dark',
	textScale: 1,
	reducedMotion: false,
	ragEnabled: false,
	embedderModel: 'Xenova/multilingual-e5-small',
	gitEnabled: false,
	gitRepoUrl: '',
	gitBranch: 'main',
	validatorEnabled: false,
	onboarded: false,
	logLevel: 'info'
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
