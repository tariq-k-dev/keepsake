import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  /*
   * Bind IPv4 explicitly. Vite defaults to localhost, which on this machine
   * resolves to ::1 only — headless Chromium resolves localhost to 127.0.0.1 and
   * then hangs for 30s per navigation. Loopback is a dev-only concern; deployment
   * is Cloudflare's edge.
   */
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    chunkSizeWarningLimit: 700,
  },
});
