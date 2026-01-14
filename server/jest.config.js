/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.js'],
  moduleFileExtensions: ['js', 'json'],
  verbose: true,
  // Silence dotenv logs during tests
  setupFiles: ['<rootDir>/jest.setup.js'],
};


