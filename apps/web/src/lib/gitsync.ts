/**
 * Git-синхронизация канона (ТЗ §3, §15): isomorphic-git + lightning-fs в браузере.
 * Канон состояния (canon.json + md) хранится в git-репо; /save = commit+push,
 * /go = pull. Кросс-девайс «открыл и продолжил» (§16.7). Файлы правил — отдельно,
 * их не трогаем.
 *
 * GitHub не отдаёт CORS для git → ходим через бэкенд-прокси (/gitproxy).
 */

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import LightningFS from '@isomorphic-git/lightning-fs';
import { migrate, type GameState } from '@rpg/engine';
import { getKey } from './keys.svelte';
import { settings } from './settings.svelte';
import { buildSaveBundle } from './reports';
import { campaigns } from './game.svelte';

const fs = new LightningFS('rpg-git');
const pfs = fs.promises;

const AUTHOR = { name: 'Text RPG', email: 'rpg@local' } as const;

function corsProxy(): string {
	return `${settings.proxyUrl}/gitproxy`;
}
function onAuth() {
	return { username: getKey('git') || 'x-access-token' };
}
/** Активная кампания → имя ветки и рабочей директории (ТЗ §15: ветка на прохождение). */
function activeId(): string {
	return campaigns.activeId ?? 'default';
}
function branch(): string {
	return campaigns.activeId ?? (settings.gitBranch || 'main');
}
/** Директория рабочего дерева кампании. */
export function campaignDir(campaign = activeId()): string {
	return `/c/${campaign}`;
}

async function isRepo(dir: string): Promise<boolean> {
	try {
		await pfs.stat(`${dir}/.git`);
		return true;
	} catch {
		return false;
	}
}

export interface SyncResult {
	ok: boolean;
	message: string;
	commit?: string;
}

/** Клонировать (или инициализировать) репо кампании. Идемпотентно. */
export async function ensureRepo(dir = campaignDir()): Promise<SyncResult> {
	const url = settings.gitRepoUrl;
	if (!url) return { ok: false, message: 'не задан git-репозиторий в настройках' };
	if (await isRepo(dir)) return { ok: true, message: 'репозиторий уже склонирован' };
	try {
		await pfs.mkdir(dir).catch(() => undefined);
		await git.clone({
			fs,
			http,
			dir,
			url,
			ref: branch(),
			singleBranch: true,
			depth: 10,
			corsProxy: corsProxy(),
			onAuth
		});
		return { ok: true, message: 'клонировано' };
	} catch (e) {
		// Пустой репозиторий или нет ветки → init + remote, ветка создастся при push.
		try {
			await git.init({ fs, dir, defaultBranch: branch() });
			await git.addRemote({ fs, dir, remote: 'origin', url }).catch(() => undefined);
			return { ok: true, message: `инициализирован (clone не удался: ${(e as Error).message})` };
		} catch (e2) {
			return { ok: false, message: `git init: ${(e2 as Error).message}` };
		}
	}
}

/** Подтянуть изменения (/go). */
export async function pull(dir = campaignDir()): Promise<SyncResult> {
	const r = await ensureRepo(dir);
	if (!r.ok) return r;
	try {
		await git.pull({ fs, http, dir, ref: branch(), singleBranch: true, fastForwardOnly: true, author: AUTHOR, corsProxy: corsProxy(), onAuth });
		return { ok: true, message: 'подтянуто' };
	} catch (e) {
		return { ok: false, message: `pull: ${(e as Error).message}` };
	}
}

/** Прочитать канон из рабочего дерева → мигрировать. null, если нет. */
export async function readCanon(dir = campaignDir()): Promise<GameState | null> {
	try {
		const raw = await pfs.readFile(`${dir}/canon.json`, 'utf8');
		return migrate(JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))).state;
	} catch {
		return null;
	}
}

/** Записать канон (JSON+md), закоммитить и запушить (/save). */
export async function commitAndPush(state: GameState, message: string, dir = campaignDir()): Promise<SyncResult> {
	const r = await ensureRepo(dir);
	if (!r.ok) return r;
	try {
		const bundle = buildSaveBundle(state);
		for (const [name, content] of Object.entries(bundle)) {
			await pfs.writeFile(`${dir}/${name}`, content, 'utf8');
			await git.add({ fs, dir, filepath: name });
		}
		const sha = await git.commit({ fs, dir, message, author: AUTHOR });
		await git.push({ fs, http, dir, remote: 'origin', ref: branch(), corsProxy: corsProxy(), onAuth });
		return { ok: true, message: 'сохранено и отправлено', commit: sha.slice(0, 8) };
	} catch (e) {
		return { ok: false, message: `commit/push: ${(e as Error).message}` };
	}
}

/** Список коммитов (точки сохранения) для UI. */
export async function history(dir = campaignDir(), depth = 20): Promise<{ oid: string; message: string }[]> {
	try {
		const log = await git.log({ fs, dir, depth, ref: branch() });
		return log.map((c) => ({ oid: c.oid.slice(0, 8), message: c.commit.message.split('\n')[0]! }));
	} catch {
		return [];
	}
}
