/**
 * RedisStore
 * Redis client wrapper for session and state storage
 * 
 * Provides connection management, error handling, and retry logic for Redis operations.
 * Supports TTL (time-to-live) for keys and emits connection events.
 */

import { createClient, RedisClientType } from 'redis';
import { EventEmitter } from 'events';

export class RedisStore extends EventEmitter {
  private client: RedisClientType | null = null;
  private redisUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelays = [1000, 2000, 5000, 10000, 30000]; // Exponential backoff
  private isConnecting = false;
  private isAvailable = false;

  constructor(redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379') {
    super();
    this.redisUrl = redisUrl;
  }

  /**
   * Connect to Redis with retry logic
   */
  async connect(): Promise<void> {
    if (this.client?.isOpen) {
      return; // Already connected
    }

    if (this.isConnecting) {
      return; // Connection in progress
    }

    this.isConnecting = true;

    try {
      this.client = createClient({
        url: this.redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries >= this.maxReconnectAttempts) {
              this.emit('error', new Error('Max reconnection attempts exceeded'));
              return false; // Stop reconnecting
            }
            const delay = this.reconnectDelays[Math.min(retries, this.reconnectDelays.length - 1)];
            this.emit('reconnecting', { attempt: retries + 1, delay });
            return delay;
          }
        }
      });

      // Set up event handlers
      this.client.on('error', (err) => {
        this.emit('error', err);
      });

      this.client.on('connect', () => {
        this.reconnectAttempts = 0;
        this.emit('connect');
      });

      this.client.on('ready', () => {
        this.emit('ready');
      });

      this.client.on('reconnecting', () => {
        this.reconnectAttempts++;
        this.emit('reconnecting', { attempt: this.reconnectAttempts });
      });

      this.client.on('end', () => {
        this.emit('disconnect');
      });

      await this.client.connect();
      this.isConnecting = false;
      this.isAvailable = true;
      this.reconnectAttempts = 0;
    } catch (error) {
      this.isConnecting = false;
      this.isAvailable = false;
      this.emit('error', error);
      throw new Error(`Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Disconnect from Redis gracefully
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.quit();
      this.client = null;
      this.emit('disconnect');
    } catch (error) {
      // Force disconnect if graceful quit fails
      if (this.client) {
        await this.client.disconnect();
      }
      this.client = null;
      this.emit('disconnect');
    }
  }

  /**
   * Get value from Redis by key
   * @param key Redis key
   * @returns Value or null if key doesn't exist
   */
  async get(key: string): Promise<string | null> {
    this.ensureConnected();
    
    try {
      return await this.client!.get(key);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Set value in Redis with optional TTL
   * @param key Redis key
   * @param value Value to store
   * @param ttl Time-to-live in seconds (optional)
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.ensureConnected();
    
    try {
      if (ttl !== undefined && ttl > 0) {
        await this.client!.setEx(key, ttl, value);
      } else {
        await this.client!.set(key, value);
      }
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to set key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete key from Redis
   * @param key Redis key to delete
   */
  async delete(key: string): Promise<void> {
    this.ensureConnected();
    
    try {
      await this.client!.del(key);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to delete key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if key exists in Redis
   * @param key Redis key
   * @returns true if key exists, false otherwise
   */
  async exists(key: string): Promise<boolean> {
    this.ensureConnected();
    
    try {
      const result = await this.client!.exists(key);
      return result === 1;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to check existence of key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get TTL (time-to-live) for a key
   * @param key Redis key
   * @returns TTL in seconds, -1 if no expiry, -2 if key doesn't exist
   */
  async getTTL(key: string): Promise<number> {
    this.ensureConnected();
    
    try {
      return await this.client!.ttl(key);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get TTL for key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Set expiry time for a key
   * @param key Redis key
   * @param ttl Time-to-live in seconds
   */
  async expire(key: string, ttl: number): Promise<void> {
    this.ensureConnected();
    
    try {
      await this.client!.expire(key, ttl);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to set expiry for key "${key}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if Redis client is connected
   */
  isConnected(): boolean {
    return this.client?.isOpen ?? false;
  }

  /**
   * Ensure client is connected, throw error if not
   */
  private ensureConnected(): void {
    if (!this.isAvailable || !this.client?.isOpen) {
      throw new Error('Redis client is not connected. Call connect() first.');
    }
  }

  /**
   * Get the underlying Redis client (for advanced operations)
   */
  getClient(): RedisClientType | null {
    return this.client;
  }
}
