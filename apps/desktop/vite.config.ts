import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri dev server contract: fixed port, no auto-open, host from TAURI_DEV_HOST.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
});
