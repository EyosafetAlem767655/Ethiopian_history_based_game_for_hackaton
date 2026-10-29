import parser from '@typescript-eslint/parser';
export default [
  {
    ignores: [
      'node_modules/**',
      '**/dist/**',
      'output/**',
      'test-results/**',
      'packages/contracts/artifacts/**',
      'apps/web/public/vision/**',
    ],
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/shared/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-debugger': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'valid-typeof': 'error',
    },
  },
];
