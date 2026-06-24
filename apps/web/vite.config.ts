import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		// Разрешаем доступ к repo-root rules/ для bundled-сида правил.
		fs: { allow: ['..', '../..'] }
	}
});
