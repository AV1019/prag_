/**
 * SessionStore
 * Manages user session storage and retrieval using Redis
 * 
 * Stores UserSession objects with 24-hour TTL and provides methods for
 * session lifecycle management. Uses key format: whatsapp:session:{userId}
 */

import { UserSession, Language, Intent, DetailLevel } from '../types';
import { RedisStore } from './RedisStore';

export class SessionStore {
  private redisStore: RedisStore;
  private memoryStore: Map<string, UserSession> = new Map();
  private readonly SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
  private readonly KEY_PREFIX = 'whatsapp:session:';

  constructor(redisStore: RedisStore) {
    this.redisStore = redisStore;
  }

  /**
   * Create a new user session
   * @param userId WhatsApp phone number (e.g., "919876543210")
   * @param userName Contact name from WhatsApp
   * @param isGroupSession Whether this is a group session
   * @param groupId Group ID if applicable
   * @param groupName Group name if applicable
   * @returns Newly created UserSession
   */
  async createSession(
    userId: string,
    userName: string = 'Unknown',
    isGroupSession: boolean = false,
    groupId?: string,
    groupName?: string
  ): Promise<UserSession> {
    const now = Date.now();
    
    const session: UserSession = {
      // Identity
      userId,
      userName,
      
      // Conversation state
      conversationHistory: [],
      currentContext: '',
      lastIntent: Intent.GENERAL_QUERY,
      
      // Preferences
      language: Language.MARATHI, // Default until user picks from menu
      languageSet: false, // Will prompt user to choose
      preferences: {
        preferVideo: false,
        detailLevel: DetailLevel.BRIEF,
        topics: []
      },
      
      // Metadata
      createdAt: now,
      lastActivity: now,
      messageCount: 0,
      
      // Group context
      isGroupSession,
      groupId,
      groupName
    };

    await this.updateSession(session);
    return session;
  }

  /**
   * Retrieve user session from storage
   * @param userId WhatsApp phone number
   * @returns UserSession or null if not found
   */
  async getSession(userId: string): Promise<UserSession | null> {
    const key = this.getKey(userId);
    
    try {
      const data = await this.redisStore.get(key);
      
      if (!data) {
        // Fallback to in-memory store
        return this.memoryStore.get(key) || null;
      }

      const session = JSON.parse(data) as UserSession;
      
      // Validate session structure
      if (!this.isValidSession(session)) {
        console.warn(`Invalid session data for user ${userId}, removing...`);
        await this.deleteSession(userId);
        return null;
      }

      return session;
    } catch (error) {
      // Redis failed — try in-memory fallback
      return this.memoryStore.get(key) || null;
    }
  }

  /**
   * Update user session in storage
   * @param session UserSession to update
   */
  async updateSession(session: UserSession): Promise<void> {
    const key = this.getKey(session.userId);
    
    // Update lastActivity timestamp
    session.lastActivity = Date.now();
    
    // Always save to in-memory store as fallback
    this.memoryStore.set(key, { ...session });
    
    try {
      const data = JSON.stringify(session);
      await this.redisStore.set(key, data, this.SESSION_TTL);
    } catch (error) {
      // Redis down — session is still in memory
      console.warn(`Redis unavailable, session for ${session.userId} stored in memory only`);
    }
  }

  /**
   * Delete user session from storage
   * @param userId WhatsApp phone number
   */
  async deleteSession(userId: string): Promise<void> {
    const key = this.getKey(userId);
    this.memoryStore.delete(key);
    
    try {
      await this.redisStore.delete(key);
    } catch (error) {
      console.warn(`Redis unavailable, could not delete session for ${userId}`);
    }
  }

  /**
   * Check if session exists
   * @param userId WhatsApp phone number
   * @returns true if session exists, false otherwise
   */
  async sessionExists(userId: string): Promise<boolean> {
    const key = this.getKey(userId);
    
    try {
      return await this.redisStore.exists(key);
    } catch (error) {
      console.error(`Failed to check session existence for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get or create session (convenience method)
   * @param userId WhatsApp phone number
   * @param userName Contact name from WhatsApp
   * @param isGroupSession Whether this is a group session
   * @param groupId Group ID if applicable
   * @param groupName Group name if applicable
   * @returns Existing or newly created UserSession
   */
  async getOrCreateSession(
    userId: string,
    userName: string = 'Unknown',
    isGroupSession: boolean = false,
    groupId?: string,
    groupName?: string
  ): Promise<UserSession> {
    let session = await this.getSession(userId);
    
    if (!session) {
      session = await this.createSession(userId, userName, isGroupSession, groupId, groupName);
    }
    
    return session;
  }

  /**
   * Get remaining TTL for a session
   * @param userId WhatsApp phone number
   * @returns TTL in seconds, -1 if no expiry, -2 if session doesn't exist
   */
  async getSessionTTL(userId: string): Promise<number> {
    const key = this.getKey(userId);
    
    try {
      return await this.redisStore.getTTL(key);
    } catch (error) {
      console.error(`Failed to get TTL for session ${userId}:`, error);
      return -2;
    }
  }

  /**
   * Refresh session TTL (extend expiry by 24 hours)
   * @param userId WhatsApp phone number
   */
  async refreshSessionTTL(userId: string): Promise<void> {
    const key = this.getKey(userId);
    
    try {
      await this.redisStore.expire(key, this.SESSION_TTL);
    } catch (error) {
      throw new Error(`Failed to refresh TTL for session ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add message to conversation history
   * @param userId WhatsApp phone number
   * @param role Message role ('user' or 'assistant')
   * @param content Message content
   * @param intent Detected intent (optional)
   * @param mediaType Media type if applicable (optional)
   */
  async addMessageToHistory(
    userId: string,
    role: 'user' | 'assistant',
    content: string,
    intent?: Intent,
    mediaType?: string
  ): Promise<void> {
    const session = await this.getSession(userId);
    
    if (!session) {
      // No session (Redis down or first message) — silently skip history
      return;
    }

    session.conversationHistory.push({
      role,
      content,
      timestamp: Date.now(),
      intent,
      mediaType
    });

    // Keep only last 20 messages to prevent session from growing too large
    if (session.conversationHistory.length > 20) {
      session.conversationHistory = session.conversationHistory.slice(-20);
    }

    session.messageCount++;
    
    if (intent) {
      session.lastIntent = intent;
    }

    await this.updateSession(session);
  }

  /**
   * Update user language preference
   * @param userId WhatsApp phone number
   * @param language Language preference
   */
  async updateLanguage(userId: string, language: Language): Promise<void> {
    const session = await this.getSession(userId);
    
    if (!session) {
      throw new Error(`Session not found for user ${userId}`);
    }

    session.language = language;
    await this.updateSession(session);
  }

  /**
   * Update current context
   * @param userId WhatsApp phone number
   * @param context Current topic/context
   */
  async updateContext(userId: string, context: string): Promise<void> {
    const session = await this.getSession(userId);
    
    if (!session) {
      throw new Error(`Session not found for user ${userId}`);
    }

    session.currentContext = context;
    await this.updateSession(session);
  }

  /**
   * Generate Redis key for user session
   * @param userId WhatsApp phone number
   * @returns Redis key
   */
  private getKey(userId: string): string {
    return `${this.KEY_PREFIX}${userId}`;
  }

  /**
   * Validate session structure
   * @param session Session object to validate
   * @returns true if valid, false otherwise
   */
  private isValidSession(session: any): session is UserSession {
    return (
      session &&
      typeof session.userId === 'string' &&
      typeof session.userName === 'string' &&
      Array.isArray(session.conversationHistory) &&
      typeof session.currentContext === 'string' &&
      typeof session.createdAt === 'number' &&
      typeof session.lastActivity === 'number' &&
      typeof session.messageCount === 'number' &&
      typeof session.isGroupSession === 'boolean'
    );
  }
}
