# Redis Storage Layer

This directory contains the Redis storage implementation for the WhatsApp bot.

## Components

### RedisStore

Base Redis connection and operations manager. Provides:
- Connection management with automatic reconnection
- Error handling and retry logic
- Basic Redis operations (get, set, delete, exists)
- TTL (time-to-live) management
- Event emission for connection state changes

### SessionStore

User session management layer built on top of RedisStore. Provides:
- User session creation and retrieval
- 24-hour TTL for sessions
- Conversation history management
- Session preferences and context tracking
- Key format: `whatsapp:session:{userId}`

## Usage Example

```typescript
import { RedisStore } from './storage/RedisStore';
import { SessionStore } from './storage/SessionStore';

// Initialize Redis connection
const redisStore = new RedisStore(process.env.REDIS_URL);

// Set up event listeners
redisStore.on('connect', () => {
  console.log('Connected to Redis');
});

redisStore.on('error', (error) => {
  console.error('Redis error:', error);
});

redisStore.on('reconnecting', ({ attempt, delay }) => {
  console.log(`Reconnecting to Redis (attempt ${attempt}, delay ${delay}ms)`);
});

// Connect to Redis
await redisStore.connect();

// Initialize session store
const sessionStore = new SessionStore(redisStore);

// Create a new user session
const session = await sessionStore.createSession(
  '919876543210',  // userId (phone number)
  'John Doe',      // userName
  false            // isGroupSession
);

// Get existing session
const existingSession = await sessionStore.getSession('919876543210');

// Add message to conversation history
await sessionStore.addMessageToHistory(
  '919876543210',
  'user',
  'Can you explain photosynthesis?',
  Intent.CONCEPT_EXPLANATION
);

// Update session context
await sessionStore.updateContext('919876543210', 'Biology - Photosynthesis');

// Update language preference
await sessionStore.updateLanguage('919876543210', Language.ENGLISH);

// Get or create session (convenience method)
const session2 = await sessionStore.getOrCreateSession(
  '919876543211',
  'Jane Smith'
);

// Check session TTL
const ttl = await sessionStore.getSessionTTL('919876543210');
console.log(`Session expires in ${ttl} seconds`);

// Refresh session TTL (extend by 24 hours)
await sessionStore.refreshSessionTTL('919876543210');

// Delete session
await sessionStore.deleteSession('919876543210');

// Disconnect when done
await redisStore.disconnect();
```

## Configuration

The Redis connection URL is configured via environment variable:

```bash
REDIS_URL=redis://localhost:6379
```

## Session Structure

```typescript
interface UserSession {
  // Identity
  userId: string              // WhatsApp phone number
  userName: string            // Contact name
  
  // Conversation state
  conversationHistory: ConversationMessage[]
  currentContext: string
  lastIntent: Intent
  
  // Preferences
  language: Language
  preferences: UserPreferences
  
  // Metadata
  createdAt: number          // Unix timestamp
  lastActivity: number       // Unix timestamp
  messageCount: number
  
  // Group context (if applicable)
  isGroupSession: boolean
  groupId?: string
  groupName?: string
}
```

## Features

### Automatic Reconnection

RedisStore implements exponential backoff for reconnection:
- Attempt 1: 1 second delay
- Attempt 2: 2 seconds delay
- Attempt 3: 5 seconds delay
- Attempt 4: 10 seconds delay
- Attempt 5: 30 seconds delay

After 5 failed attempts, the connection stops retrying and emits an error event.

### Session TTL Management

All sessions have a 24-hour TTL (86400 seconds) that is automatically refreshed on every update. Sessions are automatically deleted by Redis after 24 hours of inactivity.

### Conversation History Limiting

To prevent sessions from growing too large, conversation history is limited to the last 20 messages. Older messages are automatically removed when new messages are added.

### Error Handling

Both RedisStore and SessionStore implement comprehensive error handling:
- Connection errors are caught and emitted as events
- Operation errors include descriptive messages
- Invalid session data is detected and cleaned up
- Graceful degradation when Redis is unavailable

## Testing

Unit tests are provided in `tests/unit/storage/`:
- `RedisStore.test.ts` - Tests for Redis connection and operations
- `SessionStore.test.ts` - Tests for session management

To run tests (requires Redis to be running):

```bash
npm test -- tests/unit/storage
```

## Dependencies

- `redis` (^4.6.12) - Official Redis client for Node.js
- `events` - Node.js EventEmitter for event handling
