// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'harness/wyniki/', 'docs/zrzuty/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // src/sim i src/ai: czysta logika, bez przeglądarki i bez niedeterminizmu.
    // Ta sama reguła co w tsconfig.sim.json (brak DOM) i scripts/check-granice.mjs.
    files: ['src/sim/**/*.ts', 'src/ai/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'performance',
        'requestAnimationFrame',
        'localStorage',
      ],
      'no-restricted-imports': ['error', { paths: ['three'], patterns: ['three/*'] }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Użyj PRNG mulberry32 ze stanu sim.' },
        { object: 'Date', property: 'now', message: 'Sim nie zna czasu rzeczywistego.' },
        { object: 'performance', property: 'now', message: 'Sim nie zna czasu rzeczywistego.' },
      ],
    },
  },
  {
    files: ['harness/**/*.ts', 'scripts/**/*.mjs', 'eslint.config.js', 'vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
