import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
export default defineConfig([
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'scripts/**', 'tests/**', '*.mjs'] },
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } } },
]);
