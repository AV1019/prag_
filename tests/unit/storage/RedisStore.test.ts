/**
 * Unit tests for RedisStore
 */

import { RedisStore } from '../../../src/storage/RedisStore';

describe('RedisStore', () => {
  let redisStore: RedisStore;

  beforeEach(() => {
    redisStore = new RedisStore('redis://localhost:6379');
  });

  afterEach(async () => {
    if (redisStore.isConnected()) {
      await redisStore.disconnect();
    }
  });

  describe('Connection Management', () => {
    it('should create RedisStore instance', () => {
      expect(redisStore).toBeInstanceOf(RedisStore);
    });

    it('should not be connected initially', () => {
      expect(redisStore.isConnected()).toBe(false);
    });

    it('should emit connection events', async () => {
      const connectSpy = jest.fn();
      const readySpy = jest.fn();

      redisStore.on('connect', connectSpy);
      redisStore.on('ready', readySpy);

      await redisStore.connect();

      expect(redisStore.isConnected()).toBe(true);
      expect(connectSpy).toHaveBeenCalled();
      expect(readySpy).toHaveBeenCalled();
    });

    it('should handle multiple connect calls gracefully', async () => {
      await redisStore.connect();
      await redisStore.connect(); // Should not throw
      expect(redisStore.isConnected()).toBe(true);
    });

    it('should disconnect gracefully', async () => {
      await redisStore.connect();
      await redisStore.disconnect();
      expect(redisStore.isConnected()).toBe(false);
    });
  });

  describe('Basic Operations', () => {
    beforeEach(async () => {
      await redisStore.connect();
    });

    it('should set and get a value', async () => {
      await redisStore.set('test:key', 'test-value');
      const value = await redisStore.get('test:key');
      expect(value).toBe('test-value');
      
      // Cleanup
      await redisStore.delete('test:key');
    });

    it('should return null for non-existent key', async () => {
      const value = await redisStore.get('test:nonexistent');
      expect(value).toBeNull();
    });

    it('should set value with TTL', async () => {
      await redisStore.set('test:ttl', 'value-with-ttl', 2);
      
      const value = await redisStore.get('test:ttl');
      expect(value).toBe('value-with-ttl');
      
      const ttl = await redisStore.getTTL('test:ttl');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2);
      
      // Cleanup
      await redisStore.delete('test:ttl');
    });

    it('should delete a key', async () => {
      await redisStore.set('test:delete', 'to-be-deleted');
      await redisStore.delete('test:delete');
      
      const value = await redisStore.get('test:delete');
      expect(value).toBeNull();
    });

    it('should check if key exists', async () => {
      await redisStore.set('test:exists', 'value');
      
      const exists = await redisStore.exists('test:exists');
      expect(exists).toBe(true);
      
      const notExists = await redisStore.exists('test:notexists');
      expect(notExists).toBe(false);
      
      // Cleanup
      await redisStore.delete('test:exists');
    });

    it('should get TTL for key', async () => {
      await redisStore.set('test:ttl-check', 'value', 10);
      
      const ttl = await redisStore.getTTL('test:ttl-check');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
      
      // Cleanup
      await redisStore.delete('test:ttl-check');
    });

    it('should set expiry for existing key', async () => {
      await redisStore.set('test:expire', 'value');
      await redisStore.expire('test:expire', 5);
      
      const ttl = await redisStore.getTTL('test:expire');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5);
      
      // Cleanup
      await redisStore.delete('test:expire');
    });
  });

  describe('Error Handling', () => {
    it('should throw error when operating without connection', async () => {
      await expect(redisStore.get('test:key')).rejects.toThrow('not connected');
    });

    it('should emit error events', async () => {
      const errorSpy = jest.fn();
      redisStore.on('error', errorSpy);

      // Try to connect to invalid URL
      const invalidStore = new RedisStore('redis://invalid-host:9999');
      invalidStore.on('error', errorSpy);

      await expect(invalidStore.connect()).rejects.toThrow();
    });
  });
});
