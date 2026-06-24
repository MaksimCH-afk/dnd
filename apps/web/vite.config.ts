import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		// host:true — сервер виден в локальной сети (чтобы открыть с планшета).
		host: true,
		// Разрешаем доступ к repo-root rules/ для bundled-сида правил.
		fs: { allow: ['..', '../..'] }
	},
	preview: {
		port: 4173,
		host: true
	}
});
