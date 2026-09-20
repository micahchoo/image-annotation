import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Obsidian provides runtime exports inside the app, not in its type-only npm package.
// Tests supply explicit vi.mock factories; this alias only gives Vite a resolvable entry.
export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL('./tests/obsidian-stub.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'] },
});
