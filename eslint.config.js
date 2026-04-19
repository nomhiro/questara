'use strict';

const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'data/**', 'views/**', 'server.log', 'server.err.log', 'docs/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.mjs', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
