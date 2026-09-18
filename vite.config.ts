import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { auraApi } from './server/api.ts';

export default defineConfig({
  plugins: [react(), auraApi()],
  server: { port: 5178 },
});
