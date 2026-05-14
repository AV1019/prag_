/**
 * Jest setup file
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.METRICS_ENABLED = 'false';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.BACKEND_URL = 'http://localhost:8000';

// Increase test timeout for property-based tests
jest.setTimeout(30000);
