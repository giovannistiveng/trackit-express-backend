/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/helpers/env.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/infrastructure/http/server.ts', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary', 'lcov', 'html'],
  coverageThreshold: { global: { statements: 80, branches: 70, functions: 80, lines: 80 } },
  // Las pruebas de integración comparten una base de datos: se ejecutan en serie
  maxWorkers: 1,
  testTimeout: 20000,
};
