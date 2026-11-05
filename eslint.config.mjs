// @ts-check
import eslint from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'logs/**', 'uploads/**', 'eslint.config.mjs', 'jest.config.js'] },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended, sonarjs.configs.recommended],
    // Con información de tipos, las reglas de Sonar distinguen promesas, tipos comparados, etc.
    languageOptions: { globals: { ...globals.node }, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Igual que SonarQube S7773 y S6544
      'no-restricted-globals': ['error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite'],
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // El CLI de base de datos escribe en la consola a propósito
    files: ['src/infrastructure/database/cli.ts', 'src/infrastructure/database/migrador.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      // En pruebas se usan contraseñas, IPs y URLs de ejemplo a propósito
      'sonarjs/no-hardcoded-passwords': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-nested-functions': 'off',
      'sonarjs/pseudo-random': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
