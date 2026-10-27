import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

/**
 * Two projects, because they need different runtimes:
 *  - `engine`: plain Node. Pure rules-engine tests, fast, no Worker needed.
 *  - `room`:   real workerd via @cloudflare/vitest-plugin. Real Durable Objects,
 *              real WebSockets, real alarms — the only way to prove sync works.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'engine',
          include: ['test/engine/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'room',
          include: ['test/room/**/*.test.ts'],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
