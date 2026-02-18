import playwright from 'eslint-plugin-playwright';

export default [
  // Playwright recommended rules
  playwright.configs['flat/recommended'],

  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      // e2e-specific overrides go here
    }
  }
];
