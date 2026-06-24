/**
 * Раздача собранного тонкого клиента (apps/web/build) тем же app-сервером —
 * единый origin: ни CORS, ни ручного ввода адреса сервера. SPA-фоллбэк на
 * index.html для клиентского роутинга. Только GET; путь защищён от traversal.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.map': 'application/json; charset=utf-8'
};

function sendFile(res: ServerResponse, file: string, immutable: boolean): void {
	const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
	res.writeHead(200, {
		'Content-Type': type,
		'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
	});
	createReadStream(file).pipe(res);
}

/**
 * Пытается отдать статику клиента. Возвращает true, если запрос обслужен.
 * Хешированные ассеты (/_app/immutable/...) кэшируются навсегда; остальное — no-cache.
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse, webDir: string, path: string): boolean {
	if (req.method !== 'GET' && req.method !== 'HEAD') return false;
	if (!existsSync(webDir)) return false;

	// Нормализуем и не выпускаем за пределы webDir.
	const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
	const candidate = join(webDir, rel);
	if (!candidate.startsWith(webDir)) return false;

	if (rel !== '/' && existsSync(candidate) && statSync(candidate).isFile()) {
		sendFile(res, candidate, candidate.includes(`${join('_app', 'immutable')}`));
		return true;
	}

	// SPA-фоллбэк: любой неизвестный GET-путь → index.html (клиентский роутинг).
	const index = join(webDir, 'index.html');
	if (existsSync(index)) {
		sendFile(res, index, false);
		return true;
	}
	return false;
}
