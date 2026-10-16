// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Packages that form the headless engine: they must not print, prompt, or exit. */
const engineFiles = [
  'packages/core/**/*.ts',
  'packages/sdk/**/*.ts',
  'packages/specification/**/*.ts',
  'packages/sources/**/*.ts',
  'packages/analyzer/**/*.ts',
  'packages/planner/**/*.ts',
  'packages/deployment/**/*.ts',
  'packages/providers/**/*.ts',
  'packages/shared/**/*.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.astro/**',
      '**/coverage/**',
      'apps/web/**',
      'examples/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/packages/*/src/**', '**/apps/*/src/**', '@hero-cloud/*/src/**'],
              message: 'Import a package through its entry point, never through its src folder.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: engineFiles,
    ignores: ['**/*.test.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'prompt', message: 'The engine is headless.' },
        { name: 'alert', message: 'The engine is headless.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'exit', message: 'The engine never exits the process.' },
        { object: 'process', property: 'stdout', message: 'The engine does not print.' },
        { object: 'process', property: 'stderr', message: 'The engine does not print.' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
