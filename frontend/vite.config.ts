/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * The dev server proxies `/api` to the backend, which is why the app's default
 * base URL is a same-origin path rather than `http://localhost:3000`.
 *
 * Two reasons, one of them easy to miss: the backend sets no CORS headers, so a
 * browser calling it from another origin would refuse the response — and a
 * same-origin path is also what a deployed build wants, since the static files
 * and the API are normally served behind one host. Pointing `VITE_API_BASE_URL`
 * at an absolute origin works too, but then the API has to allow that origin.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget = env['VITE_API_PROXY_TARGET']?.trim() || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          // `/api/policies` is `/policies` on the backend: the prefix exists to
          // give the dev proxy and a production reverse proxy one thing to match
          // on, not to be part of the API's own paths.
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
    },
  };
});
