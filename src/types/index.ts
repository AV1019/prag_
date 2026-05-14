/**
 * Type definitions and interfaces for WhatsApp Web.js Bot Integration
 * 
 * This file contains all TypeScript types, interfaces, and enums used throughout
 * the WhatsApp bot application.
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Connection states for WhatsApp Web session
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  AUTHENTICATED = 'authenticated',
  READY = 'ready'
}

/**
 * Intent types for message classification
 */
export enum Intent {
  VIDEO_GENERATION = 'video_generation',
  MINDMAP_REQUEST = 'mindmap_request',
  QUIZ_REQUEST = 'quiz_request',
  CONCEPT_EXPLANATION = 'concept_explanation',
  QUESTION_ANSWER = 'question_answer',
  MATH_PROBLEM = 'math_problem',
  CODE_HELP = 'code_help',
  GENERAL_QUERY = 'general_query',
  COMMAND = 'command'
}

/**
 * Supported languages
 */
export enum Language {
  ENGLISH = 'english',
  MARATHI = 'marathi',
  HINDI = 'hindi',
  KANNADA = 'kannada',
  TAMIL = 'tamil',
  TELUGU = 'telugu',
  MALAYALAM = 'malayalam',
  BENGALI = 'bengali',
  GUJARATI = 'gujarati',
  PUNJABI = 'punjabi',
}

/**
 * Media types supported by WhatsApp
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  AUDIO = 'audio'
}

/**
 * Message priority levels for queue processing
 */
export enum MessagePriority {
  HIGH = 'high',
  NORMAL = 'normal',
  LOW = 'low'
}

/**
 * Detail levels for responses
 */
export enum DetailLevel {
  BRIEF = 'brief',
  DETAILED = 'detailed'
}

/**
 * Handler types for message routing
 */
export enum HandlerType {
  CONTENT_GENERATOR = 'content_generator',
  COMMAND = 'command',
  FALLBACK = 'fallback'
}

// ============================================================================
// Core Message Types
// ============================================================================

/**
 * Extracted data from incoming WhatsApp message
 */
export interface MessageData {
  /** Unique message identifier */
  id: string
  
  /** Sender's phone number with country code (e.g., "919876543210") */
  from: string
  
  /** Sender's contact name from WhatsApp */
  fromName: string
  
  /** Message text content */
  body: string
  
  /** Unix timestamp of message */
  timestamp: number
  
  /** Whether message contains media */
  hasMedia: boolean
  
  /** Type of media if present */
  mediaType?: MediaType
  
  /** Whether message is from a group */
  isGroup: boolean
  
  /** Group ID if message is from a group */
  groupId?: string
  
  /** Array of mentioned user IDs in group messages */
  mentionedIds?: string[]
}

/**
 * Routing decision for message processing
 */
export interface RouteDecision {
  /** Handler to process the message */
  handler: HandlerType
  
  /** Detected intent of the message */
  intent: Intent
  
  /** Confidence score (0-1) for the routing decision */
  confidence: number
  
  /** Additional parameters extracted from message */
  parameters: Record<string, any>
}

// ============================================================================
// Session Management Types
// ============================================================================

/**
 * Individual message in conversation history
 */
export interface ConversationMessage {
  /** Role of the message sender */
  role: 'user' | 'assistant'
  
  /** Message content */
  content: string
  
  /** Unix timestamp */
  timestamp: number
  
  /** Detected intent (for user messages) */
  intent?: Intent
  
  /** Media type if message contained media */
  mediaType?: string
}

/**
 * User preferences for personalized responses
 */
export interface UserPreferences {
  /** Whether user prefers video content */
  preferVideo: boolean
  
  /** Preferred level of detail in responses */
  detailLevel: DetailLevel
  
  /** Topics of interest */
  topics: string[]
}

/**
 * User session data for conversation context
 */
export interface UserSession {
  // Identity
  /** WhatsApp phone number (e.g., "919876543210") */
  userId: string
  
  /** Contact name from WhatsApp */
  userName: string
  
  // Conversation state
  /** History of messages in this conversation */
  conversationHistory: ConversationMessage[]
  
  /** Current topic being discussed */
  currentContext: string
  
  /** Last detected intent */
  lastIntent: Intent
  
  // Preferences
  /** User's preferred language */
  language: Language
  
  /** Whether the user has chosen their language */
  languageSet: boolean
  
  /** User preferences */
  preferences: UserPreferences
  
  // Metadata
  /** Unix timestamp of session creation */
  createdAt: number
  
  /** Unix timestamp of last activity */
  lastActivity: number
  
  /** Total number of messages in session */
  messageCount: number
  
  // Group context (if applicable)
  /** Whether this is a group session */
  isGroupSession: boolean
  
  /** Group ID if this is a group session */
  groupId?: string
  
  /** Group name if this is a group session */
  groupName?: string

  /** Outstanding MCQ waiting for the user to answer with A/B/C/D (or 1/2/3/4). */
  pendingQuiz?: PendingQuiz

  /**
   * Per-topic history of previously asked quiz questions (last 10 per topic).
   * Keyed by normalised topic string. Sent to the backend so the LLM avoids
   * generating the same question twice for the same user.
   */
  quizHistory?: Record<string, string[]>
}

/**
 * Active multiple-choice question awaiting the user's answer.
 * Set when the bot sends a Poll, cleared when the user replies with a letter.
 */
export interface PendingQuiz {
  /** The question text */
  question: string
  /** The 4 answer options in display order */
  options: string[]
  /** 0-based index of the correct option */
  correctIndex: number
  /** Letter form of the correct option — 'A' | 'B' | 'C' | 'D' */
  correctLetter: string
  /** Short explanation of why the correct option is right */
  explanation: string
  /** Topic of the quiz (for follow-up context) */
  topic: string
  /** Unix ms when the quiz was posted (used to expire stale quizzes) */
  askedAt: number
}

// ============================================================================
// Content Generation Types
// ============================================================================

/**
 * Result from video generation
 */
export interface VideoResult {
  /** Whether video generation was successful */
  success: boolean
  
  /** URL to the generated video */
  videoUrl?: string
  
  /** URL to subtitles file */
  subtitlesUrl?: string
  
  /** Video duration in seconds */
  duration?: number
  
  /** Topic of the video */
  topic?: string
  
  /** Text explanation accompanying the video */
  explanation?: string
  
  /** Error message if generation failed */
  errorMessage?: string
}

/**
 * Formatted response ready for WhatsApp delivery
 */
export interface FormattedResponse {
  /** Text content (may be split into multiple messages) */
  text: string | string[]
  
  /** URL to media file if applicable */
  mediaUrl?: string
  
  /** Type of media */
  mediaType?: MediaType
  
  /** Caption for media */
  caption?: string
}

// ============================================================================
// Queue and Processing Types
// ============================================================================

/**
 * Message queued for processing
 */
export interface QueuedMessage {
  /** Unique queue item identifier */
  id: string
  
  /** User ID (phone number) */
  userId: string
  
  /** Extracted message data */
  messageData: MessageData
  
  /** Routing decision */
  routeDecision: RouteDecision
  
  /** Priority level */
  priority: MessagePriority
  
  /** Number of retry attempts */
  retryCount: number
  
  /** Unix timestamp of creation */
  createdAt: number
  
  /** Unix timestamp after which to process (for rate limiting) */
  processAfter: number
}

// ============================================================================
// Connection and State Types
// ============================================================================

/**
 * WhatsApp connection state information
 */
export interface ConnectionStateInfo {
  /** Current connection status */
  status: ConnectionState
  
  /** Unix timestamp of last successful connection */
  lastConnected: number
  
  /** Unix timestamp of last disconnection */
  lastDisconnected: number
  
  /** Number of reconnection attempts */
  reconnectAttempts: number
  
  /** Whether QR code has been generated */
  qrCodeGenerated: boolean
  
  /** Path to QR code image file */
  qrCodePath?: string
  
  /** Error message if connection failed */
  error?: string
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Application configuration
 */
export interface BotConfig {
  // Environment
  nodeEnv: string
  
  // Backend integration
  backendUrl: string
  internalApiKey: string
  
  // Storage
  redisUrl: string
  wwebjsSessionPath: string
  
  // WhatsApp configuration
  wwebjsHeadless: boolean
  groupFeaturesEnabled: boolean
  privacyMode: boolean
  
  // Rate limiting
  messagesPerMinute: number
  maxQueueSize: number
  
  // Monitoring
  metricsEnabled: boolean
  logLevel: string
  
  // Health check
  healthCheckPort: number
}

// ============================================================================
// API Integration Types
// ============================================================================

/**
 * Request to FastAPI intent processing endpoint
 */
export interface IntentProcessRequest {
  /** User query */
  query: string
  
  /** Input modality */
  modality: 'text' | 'visual' | 'voice'
  
  /** Base64 encoded image data (for visual modality) */
  image_data?: string
  
  /** Language preference */
  language: string
  
  /** User identifier */
  user_id: string
}

/**
 * Response from FastAPI intent processing endpoint
 */
export interface IntentProcessResponse {
  /** Generated video URL */
  video_url?: string
  
  /** Text explanation */
  explanation?: string
  
  /** Video duration */
  duration?: number
  
  /** Processing status */
  status: string
  
  /** Error message if failed */
  error?: string
}

/**
 * Request to video generation endpoint
 */
export interface VideoGenerateRequest {
  /** Concept to explain */
  concept: string
  
  /** Language preference */
  language: string
  
  /** User identifier */
  user_id: string
}

/**
 * Response from video status endpoint
 */
export interface VideoStatusResponse {
  /** Job identifier */
  job_id: string
  
  /** Processing status */
  status: 'pending' | 'processing' | 'queued' | 'agents' | 'generating_script' | 'narrating' | 'rendering' | 'completed' | 'failed'

  /** Progress percentage (0-100) while rendering */
  progress?: number

  /** Video URL if completed */
  video_url?: string

  /** Subtitles URL if available */
  subtitles_url?: string

  /** Error message if failed */
  error?: string

  /** Error message if failed */
  error_message?: string
}

/**
 * Progress update payload emitted while a video is still rendering.
 */
export interface VideoProgressUpdate {
  /** Current backend stage (e.g. generating_script / narrating / rendering) */
  stage: string

  /** Progress percentage 0-100 */
  progress: number

  /** Seconds elapsed since polling started */
  elapsedSeconds: number
}

/**
 * Callback invoked periodically while a video is being rendered so the bot
 * can send "still cooking" nudges to the user.
 */
export type VideoProgressCallback = (update: VideoProgressUpdate) => void | Promise<void>

// ============================================================================
// Monitoring and Metrics Types
// ============================================================================

/**
 * Health check response
 */
export interface HealthCheckResponse {
  /** Overall health status */
  status: 'healthy' | 'unhealthy'
  
  /** WhatsApp connection state */
  whatsapp_connection: ConnectionState
  
  /** Last successful connection timestamp */
  last_connected: number
  
  /** Process uptime in seconds */
  uptime: number
  
  /** Memory usage information */
  memory: NodeJS.MemoryUsage
  
  /** Application version */
  version?: string
}

/**
 * Metric data point
 */
export interface MetricData {
  /** Metric name */
  name: string
  
  /** Metric value */
  value: number
  
  /** Metric labels */
  labels: Record<string, string>
  
  /** Unix timestamp */
  timestamp: number
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Custom error for connection failures
 */
export class ConnectionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * Custom error for message processing failures
 */
export class MessageProcessingError extends Error {
  constructor(
    message: string,
    public readonly messageId: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'MessageProcessingError'
  }
}

/**
 * Custom error for content generation failures
 */
export class ContentGenerationError extends Error {
  constructor(
    message: string,
    public readonly intent: Intent,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'ContentGenerationError'
  }
}

/**
 * Custom error for rate limiting
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfter: number
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Type guard to check if a value is a valid Intent
 */
export function isIntent(value: any): value is Intent {
  return Object.values(Intent).includes(value)
}

/**
 * Type guard to check if a value is a valid MediaType
 */
export function isMediaType(value: any): value is MediaType {
  return Object.values(MediaType).includes(value)
}

/**
 * Type guard to check if a value is a valid Language
 */
export function isLanguage(value: any): value is Language {
  return Object.values(Language).includes(value)
}

/**
 * Type guard to check if a value is a valid ConnectionState
 */
export function isConnectionState(value: any): value is ConnectionState {
  return Object.values(ConnectionState).includes(value)
}
