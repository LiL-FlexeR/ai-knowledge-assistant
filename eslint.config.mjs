import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next/core-web-vitals';

export default [
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        module: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    ignores: [
      '.agents/**',
      '.codex/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      '.local/**',
      '**/src/generated/**',
    ],
  },
  ...tseslint.config(js.configs.recommended, tseslint.configs.recommended, {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  }),
  ...next.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx,mjs}'],
  })),
  {
    files: ['apps/web/**/*.{ts,tsx,mjs}'],
    settings: { next: { rootDir: 'apps/web/' } },
  },
];
