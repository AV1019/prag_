/**
 * Unit tests for logger utility
 */

import { 
  maskPhoneNumber, 
  generateCorrelationId,
  createLoggerWithCorrelation 
} from '../../../src/utils/logger';

describe('Logger Utility', () => {
  describe('maskPhoneNumber', () => {
    it('should mask phone numbers correctly', () => {
      expect(maskPhoneNumber('919876543210')).toBe('91******10');
      expect(maskPhoneNumber('1234567890')).toBe('12******90');
    });

    it('should handle short phone numbers', () => {
      expect(maskPhoneNumber('123')).toBe('****');
      expect(maskPhoneNumber('12')).toBe('****');
    });

    it('should handle empty strings', () => {
      expect(maskPhoneNumber('')).toBe('****');
    });
  });

  describe('generateCorrelationId', () => {
    it('should generate a valid UUID', () => {
      const id = generateCorrelationId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('createLoggerWithCorrelation', () => {
    it('should create a logger with correlation ID', () => {
      const correlationId = generateCorrelationId();
      const logger = createLoggerWithCorrelation(correlationId);
      expect(logger).toBeDefined();
    });
  });
});
