import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'data/', 'goal-loop/', '.claude/', 'docs/', 'showcase/assets/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  { files: ['src/ui/**/*.js'], languageOptions: { globals: { ...globals.browser, ...globals.worker } } },
  { files: ['src/core/**/*.js'], languageOptions: { globals: { Intl: 'readonly' } } },
];
