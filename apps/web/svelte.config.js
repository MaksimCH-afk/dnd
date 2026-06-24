import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** Local-first SPA: оболочка пререндерится, рантайм работает в браузере. @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: 'index.html' // SPA-фоллбэк для клиентского роутинга
		}),
		alias: {
			'@rpg/engine': '../../packages/engine/src/index.ts'
		}
	}
};

export default config;
