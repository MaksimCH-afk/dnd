/**
 * Канонический список файлов правил (основа всей механики, контент v3.0).
 * Эти 9 файлов горячо заменяемы из UI (см. RulesStore во фронтенде); движок и
 * сборка промптов читают правила из стора. В git-репо канона — защищённая
 * директория, `/save` их не трогает (ТЗ §15).
 */

export const RULE_FILES = [
	'world',
	'magic',
	'religions',
	'systems',
	'progression',
	'master',
	'creation',
	'commands'
] as const;

export type RuleName = (typeof RULE_FILES)[number];

export const RULE_TITLES: Record<RuleName, string> = {
	world: 'Мир и его законы',
	magic: 'Магия — единая система',
	religions: 'Религии, боги и культы',
	systems: 'Системы: бой · время · экономика',
	progression: 'Развитие и последствия',
	master: 'Инструкция мастера',
	creation: 'Создание игры и персонажа',
	commands: 'Команды мастера (/go /save /ask)'
};

export function isRuleName(name: string): name is RuleName {
	return (RULE_FILES as readonly string[]).includes(name);
}
