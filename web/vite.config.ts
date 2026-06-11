import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': env.API_PROXY || 'http://localhost:3000',
      },
    },
  };
});
