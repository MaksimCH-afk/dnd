/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Офлайн-оболочка (ТЗ 18.7, 19): сама оболочка и статика доступны офлайн.
 * LLM-ходы требуют сети — это обрабатывается в UI понятным сообщением.
 * Игровой канон офлайн-доступен через IndexedDB/git-кэш — фаза 1.
 */

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `rpg-shell-${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(ASSETS);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	// Только same-origin статика. Запросы к прокси (LLM) — всегда сеть, не кэшируем.
	if (url.origin !== sw.location.origin) return;
	// API app-сервера (тот же origin) — всегда сеть, не кэшируем (свежие кампании/конфиг/ход).
	if (/^\/(admin|campaigns|turn|health)\b/.test(url.pathname)) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Закэшированная статика билда — cache-first.
			if (ASSETS.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			// Прочее — network-first с фоллбэком на кэш (оболочка офлайн).
			try {
				const response = await fetch(request);
				if (response.ok && response.type === 'basic') {
					cache.put(request, response.clone());
				}
				return response;
			} catch {
				const cached = await cache.match(request);
				if (cached) return cached;
				const shell = await cache.match('/');
				if (shell) return shell;
				throw new Error('офлайн и нет кэша');
			}
		})()
	);
});
