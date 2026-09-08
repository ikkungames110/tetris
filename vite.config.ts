import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.ACCOUNTS_DEV_API ?? 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    rolldownOptions: { input: { main: 'index.html', legal: 'legal/index.html' } },
  },
});
