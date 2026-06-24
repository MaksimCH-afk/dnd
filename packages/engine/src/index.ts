/**
 * @rpg/engine — детерминированный движок состояния текстового НРИ.
 *
 * Фреймворк-агностичный: исполняется в браузере (внутри PWA). Источник истины
 * для игрового состояния, механики, дельт. См. docs/TZ.md разделы 4, 7, 9.
 *
 * Фаза 0: общие типы, конфиг ролей, схема операций, контракт с бэкендом.
 * Состояние/механика наполняются в фазах 1+.
 */

export * from './config';
export * from './ops';
export * from './protocol';
export * from './rules';
export * from './state';
export * from './apply';
export * from './rng';
export * from './creation';
