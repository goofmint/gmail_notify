import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'node_modules/**']),
  {
    files: ['**/*.{js,ts}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            unknown: { message: 'unknown は使わず、zod で検証して型を付ける。' },
          },
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ClassDeclaration', message: 'class は使わない。関数とオブジェクトで書く。' },
        { selector: 'ClassExpression', message: 'class は使わない。関数とオブジェクトで書く。' },
      ],
    },
  },
);
