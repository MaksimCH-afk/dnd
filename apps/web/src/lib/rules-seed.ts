/**
 * Bundled-сид правил: содержимое файлов из repo-root `rules/` инлайнится Vite
 * на сборке. Это стартовая версия для RulesStore; в рантайме пользователь может
 * загрузить новые версии (они переопределяют сид).
 */

import { RULE_FILES, type RuleName } from '@rpg/engine';

// Импортируем все md из rules/ (путь относительно этого файла до корня репо).
const raw = import.meta.glob('../../../../rules/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Версия сида — пересобирается при изменении bundled-правил. */
export const SEED_VERSION = 'bundled-v3.0';

function buildSeed(): Record<RuleName, string> {
	const out = {} as Record<RuleName, string>;
	for (const [path, content] of Object.entries(raw)) {
		const base = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
		if ((RULE_FILES as readonly string[]).includes(base)) {
			out[base as RuleName] = content;
		}
	}
	return out;
}

export const RULES_SEED: Record<RuleName, string> = buildSeed();
