/**
 * RulesStore — горячо заменяемые файлы правил (требование пользователя: 9 файлов
 * правил — основа механики, обновляются без пересборки).
 *
 * Источник по умолчанию — bundled-сид (RULES_SEED). Пользователь может загрузить
 * новую версию любого файла; она хранится в IndexedDB и переопределяет сид.
 * Движок и сборка промптов читают актуальный контент через getRuleContent().
 */

import { browser } from '$app/environment';
import { RULE_FILES, type RuleName } from '@rpg/engine';
import { IdbStore } from './idb';
import { RULES_SEED, SEED_VERSION } from './rules-seed';

export interface RuleEntry {
	content: string;
	source: 'bundled' | 'uploaded';
	/** Версия: SEED_VERSION для bundled или метка загрузки. */
	version: string;
	updatedAt: number;
	bytes: number;
}

const store = browser ? new IdbStore<RuleEntry>('rpg-rules', 'rules') : null;

export const rulesState = $state<{
	ready: boolean;
	entries: Partial<Record<RuleName, RuleEntry>>;
}>({ ready: false, entries: {} });

function bytesOf(s: string): number {
	return new TextEncoder().encode(s).length;
}

function seedEntry(name: RuleName): RuleEntry {
	const content = RULES_SEED[name] ?? '';
	return { content, source: 'bundled', version: SEED_VERSION, updatedAt: 0, bytes: bytesOf(content) };
}

/** Инициализация: загрузить из IndexedDB, недостающее — засеять из bundle. */
export async function initRules(): Promise<void> {
	if (!browser || !store) {
		// SSR/нет браузера — отдаём bundled из памяти.
		for (const name of RULE_FILES) rulesState.entries[name] = seedEntry(name);
		rulesState.ready = true;
		return;
	}
	for (const name of RULE_FILES) {
		const existing = await store.get(name);
		if (existing) {
			rulesState.entries[name] = existing;
		} else {
			const seed = seedEntry(name);
			await store.set(name, seed);
			rulesState.entries[name] = seed;
		}
	}
	rulesState.ready = true;
}

/** Загрузить новую версию файла правил (из UI). */
export async function setRule(name: RuleName, content: string): Promise<void> {
	const entry: RuleEntry = {
		content,
		source: 'uploaded',
		version: `uploaded-${new Date().toISOString().slice(0, 19)}`,
		updatedAt: Date.now(),
		bytes: bytesOf(content)
	};
	if (store) await store.set(name, entry);
	rulesState.entries[name] = entry;
}

/** Вернуть файл к bundled-версии. */
export async function resetRule(name: RuleName): Promise<void> {
	const seed = seedEntry(name);
	if (store) await store.set(name, seed);
	rulesState.entries[name] = seed;
}

/** Актуальный контент файла (из стора, иначе bundled-сид). */
export function getRuleContent(name: RuleName): string {
	return rulesState.entries[name]?.content ?? RULES_SEED[name] ?? '';
}
