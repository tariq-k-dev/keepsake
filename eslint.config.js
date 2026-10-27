import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-worker',
      '.wrangler',
      'coverage',
      'node_modules',
      'worker-configuration.d.ts',
      'artifacts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['src/worker/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['**/*.config.{ts,js}', 'test/**/*.ts', 'scripts/**/*.{ts,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
