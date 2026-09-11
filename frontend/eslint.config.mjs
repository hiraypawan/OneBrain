import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', '.open-next/**'] },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript checks identifiers and declarations, including browser globals.
      'no-undef': 'off', 'no-unused-vars': 'off',
      // Existing recovery paths intentionally tolerate missing browser capabilities.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
