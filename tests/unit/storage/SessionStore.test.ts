/**
 * Unit tests for SessionStore
 */

import { SessionStore } from '../../../src/storage/SessionStore';
import { RedisStore } from '../../../src/storage/RedisStore';
import { Language, Intent } from '../../../src/types';

describe('SessionStore', () => {
  let redisStore: RedisStore;
  let sessionStore: SessionStore;

  beforeAll(async () => {
    redisStore = new RedisStore('redis://localhost:6379');
    await redisStore.connect();
    sessionStore = new SessionStore(redisStore);
  });

  afterAll(async () => {
    await redisStore.disconnect();
  });

  afterEach(async () => {
    // Clean up test sessions
    const testUserIds = ['919876543210', '919876543211', '919876543212'];
    for (const userId of testUserIds) {
      try {
        await sessionStore.deleteSession(userId);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('Session Creation', () => {
    it('should create a new session', async () => {
      const session = await sessionStore.createSession('919876543210', 'Test User');

      expect(session).toBeDefined();
      expect(session.userId).toBe('919876543210');
      expect(session.userName).toBe('Test User');
      expect(session.conversationHistory).toEqual([]);
      expect(session.language).toBe(Language.HINGLISH);
      expect(session.messageCount).toBe(0);
      expect(session.isGroupSession).toBe(false);
    });

    it('should create a group session', async () => {
      const session = await sessionStore.createSession(
        '919876543210',
        'Test Group',
        true,
        'group123',
        'Test Group Name'
      );

      expect(session.isGroupSession).toBe(true);
      expect(session.groupId).toBe('group123');
      expect(session.groupName).toBe('Test Group Name');
    });

    it('should use default values when not provided', async () => {
      const session = await sessionStore.createSession('919876543210');

      expect(session.userName).toBe('Unknown');
      expect(session.isGroupSession).toBe(false);
      expect(session.groupId).toBeUndefined();
    });
  });

  describe('Session Retrieval', () => {
    it('should retrieve an existing session', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      const session = await sessionStore.getSession('919876543210');
      
      expect(session).not.toBeNull();
      expect(session?.userId).toBe('919876543210');
      expect(session?.userName).toBe('Test User');
    });

    it('should return null for non-existent session', async () => {
      const session = await sessionStore.getSession('919999999999');
      expect(session).toBeNull();
    });

    it('should check if session exists', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      const exists = await sessionStore.sessionExists('919876543210');
      expect(exists).toBe(true);
      
      const notExists = await sessionStore.sessionExists('919999999999');
      expect(notExists).toBe(false);
    });
  });

  describe('Session Update', () => {
    it('should update session data', async () => {
      const session = await sessionStore.createSession('919876543210', 'Test User');
      
      session.currentContext = 'Math problems';
      session.messageCount = 5;
      
      await sessionStore.updateSession(session);
      
      const retrieved = await sessionStore.getSession('919876543210');
      expect(retrieved?.currentContext).toBe('Math problems');
      expect(retrieved?.messageCount).toBe(5);
    });

    it('should update lastActivity timestamp on update', async () => {
      const session = await sessionStore.createSession('919876543210', 'Test User');
      const originalActivity = session.lastActivity;
      
      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await sessionStore.updateSession(session);
      
      const retrieved = await sessionStore.getSession('919876543210');
      expect(retrieved?.lastActivity).toBeGreaterThan(originalActivity);
    });
  });

  describe('Session Deletion', () => {
    it('should delete a session', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      await sessionStore.deleteSession('919876543210');
      
      const session = await sessionStore.getSession('919876543210');
      expect(session).toBeNull();
    });

    it('should not throw when deleting non-existent session', async () => {
      await expect(sessionStore.deleteSession('919999999999')).resolves.not.toThrow();
    });
  });

  describe('Get or Create Session', () => {
    it('should return existing session if it exists', async () => {
      const created = await sessionStore.createSession('919876543210', 'Test User');
      
      const retrieved = await sessionStore.getOrCreateSession('919876543210', 'Different Name');
      
      expect(retrieved.userId).toBe(created.userId);
      expect(retrieved.userName).toBe('Test User'); // Original name, not new one
    });

    it('should create new session if it does not exist', async () => {
      const session = await sessionStore.getOrCreateSession('919876543211', 'New User');
      
      expect(session.userId).toBe('919876543211');
      expect(session.userName).toBe('New User');
    });
  });

  describe('Session TTL Management', () => {
    it('should set 24-hour TTL on session creation', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      const ttl = await sessionStore.getSessionTTL('919876543210');
      
      // TTL should be close to 24 hours (86400 seconds)
      expect(ttl).toBeGreaterThan(86000);
      expect(ttl).toBeLessThanOrEqual(86400);
    });

    it('should refresh session TTL', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await sessionStore.refreshSessionTTL('919876543210');
      
      const ttl = await sessionStore.getSessionTTL('919876543210');
      expect(ttl).toBeGreaterThan(86000);
    });
  });

  describe('Conversation History', () => {
    it('should add message to conversation history', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      await sessionStore.addMessageToHistory(
        '919876543210',
        'user',
        'Hello, can you help me?',
        Intent.GENERAL_QUERY
      );
      
      const session = await sessionStore.getSession('919876543210');
      
      expect(session?.conversationHistory).toHaveLength(1);
      expect(session?.conversationHistory[0].role).toBe('user');
      expect(session?.conversationHistory[0].content).toBe('Hello, can you help me?');
      expect(session?.conversationHistory[0].intent).toBe(Intent.GENERAL_QUERY);
      expect(session?.messageCount).toBe(1);
      expect(session?.lastIntent).toBe(Intent.GENERAL_QUERY);
    });

    it('should limit conversation history to 20 messages', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      // Add 25 messages
      for (let i = 0; i < 25; i++) {
        await sessionStore.addMessageToHistory(
          '919876543210',
          i % 2 === 0 ? 'user' : 'assistant',
          `Message ${i}`
        );
      }
      
      const session = await sessionStore.getSession('919876543210');
      
      // Should only keep last 20
      expect(session?.conversationHistory).toHaveLength(20);
      expect(session?.messageCount).toBe(25);
      
      // Should have the last messages
      expect(session?.conversationHistory[19].content).toBe('Message 24');
    });

    it('should throw error when adding message to non-existent session', async () => {
      await expect(
        sessionStore.addMessageToHistory('919999999999', 'user', 'Hello')
      ).rejects.toThrow('Session not found');
    });
  });

  describe('Session Preferences', () => {
    it('should update language preference', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      await sessionStore.updateLanguage('919876543210', Language.ENGLISH);
      
      const session = await sessionStore.getSession('919876543210');
      expect(session?.language).toBe(Language.ENGLISH);
    });

    it('should update current context', async () => {
      await sessionStore.createSession('919876543210', 'Test User');
      
      await sessionStore.updateContext('919876543210', 'Discussing algebra');
      
      const session = await sessionStore.getSession('919876543210');
      expect(session?.currentContext).toBe('Discussing algebra');
    });

    it('should throw error when updating non-existent session', async () => {
      await expect(
        sessionStore.updateLanguage('919999999999', Language.ENGLISH)
      ).rejects.toThrow('Session not found');
      
      await expect(
        sessionStore.updateContext('919999999999', 'Context')
      ).rejects.toThrow('Session not found');
    });
  });
});
