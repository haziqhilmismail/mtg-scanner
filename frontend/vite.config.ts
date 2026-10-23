import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api/* to the FastAPI backend so the React app can use relative URLs
// and we don't need to deal with CORS during dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
