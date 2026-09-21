import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.deps/**',
      'engine/**',
      'node_modules/**',
      'public/pikafish*.js',
      'public/pikafish-core*.js',
      'test-results/**',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-empty': 'off',
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['vite.config.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
  },
  /*
   * The test scripts, which used to match no block at all.
   *
   * `eslint .` walked all 153 of them and applied nothing, so the report said
   * they were fine because nothing had been asked. That is the same shape of
   * hole as a typecheck that checks no files: a green result from a command
   * that never looked. Turning the recommended set on found only cosmetics --
   * so nothing was being hidden today -- but these scripts are where the
   * browser gate lives, and its hundreds of failure messages are template
   * literals naming variables. A typo in one of those runs only when that
   * assertion fails, which is exactly when the message is needed.
   *
   * Node and browser globals together, because roughly half of every one of
   * these files is the inside of a `page.evaluate` callback. The three
   * exemptions match the `src` block above so one convention covers the repo:
   * `catch {}` is how these scripts say "this may fail and that is fine", and
   * `_` is how they say "this argument exists and is not wanted".
   */
  {
    extends: [js.configs.recommended],
    files: ['scripts/**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-empty': 'off',
      // Every occurrence is `\u001B[...m` -- stripping ANSI colour out of a
      // captured stdout so it can be matched. There is no other control
      // character in these scripts, and the rule has no exemption for that.
      'no-control-regex': 'off',
      'no-unused-vars': ['error', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { sourceType: 'module' },
  },
);
