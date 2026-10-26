import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const baseExtends = [js.configs.recommended, ...tseslint.configs.recommended];

// TEMPORARY BASELINE: pre-existing stylistic/debt findings are reported as
// warnings so `npm run lint` is usable as a gate for genuine bugs
// (rules-of-hooks, no-undef, parse errors, ...), which remain errors.
// Counts and ownership: docs/recovery/S06-lint-baseline.md. Promote these
// back to errors as the debt is paid down.
const baselineDebtRules = {
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/no-require-imports': 'warn',
  '@typescript-eslint/no-namespace': 'warn',
  'no-empty': 'warn',
  'prefer-const': 'warn',
  'no-useless-escape': 'warn',
  'no-case-declarations': 'warn',
  'no-control-regex': 'warn',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'attached_assets'] },
  // Browser code: React client.
  {
    extends: baseExtends,
    files: ['client/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...baselineDebtRules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Node code: server, scripts, tests, shared and root-level files.
  {
    extends: baseExtends,
    files: ['server/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', '*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: baselineDebtRules,
  }
);
