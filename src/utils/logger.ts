/**
 * Logger utility using Winston
 * Provides structured logging with JSON formatting, correlation IDs, and privacy features
 * 
 * Features:
 * - Multiple log levels (error, warn, info, debug)
 * - JSON formatting for structured logging
 * - Correlation ID tracking for request tracing
 * - Phone number masking for privacy
 * - Environment-based configuration
 * - Console and optional file logging
 */

import winston from 'winston';
import { randomUUID } from 'crypto';

// Determine log level based on environment
const nodeEnv = process.env.NODE_ENV || 'development';
const logLevel = process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug');

// Enable file logging in production
const enableFileLogging = process.env.ENABLE_FILE_LOGGING === 'true' || nodeEnv === 'production';
const logFilePath = process.env.LOG_FILE_PATH || './logs/whatsapp-bot.log';

/**
 * Custom format to mask phone numbers in log messages
 */
const maskSensitiveData = winston.format((info) => {
  // Mask phone numbers in message
  if (typeof info.message === 'string') {
    info.message = info.message.replace(/\b(\d{2})\d{6,10}(\d{2})\b/g, '$1******$2');
  }
  
  // Mask phone numbers in metadata
  if (info.from && typeof info.from === 'string') {
    info.from = maskPhoneNumber(info.from);
  }
  if (info.userId && typeof info.userId === 'string') {
    info.userId = maskPhoneNumber(info.userId);
  }
  if (info.phoneNumber && typeof info.phoneNumber === 'string') {
    info.phoneNumber = maskPhoneNumber(info.phoneNumber);
  }
  
  return info;
});

/**
 * Configure Winston transports
 */
const transports: winston.transport[] = [
  // Console transport with colorized output for development
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, correlationId, ...meta }) => {
        const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
        const corrId = correlationId ? `[${correlationId}]` : '';
        return `${timestamp} ${level} ${corrId}: ${message} ${metaStr}`;
      })
    )
  })
];

// Add file transport in production or when explicitly enabled
if (enableFileLogging) {
  transports.push(
    new winston.transports.File({
      filename: logFilePath,
      format: winston.format.json(), // Always use JSON for file logs
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    })
  );
}

/**
 * Main Winston logger instance
 */
export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    maskSensitiveData(),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'gyan-whatsapp-bot',
    environment: nodeEnv
  },
  transports
});

/**
 * Mask phone numbers for privacy
 * Replaces middle digits with asterisks
 * 
 * @param phoneNumber - Phone number to mask (e.g., "919876543210")
 * @returns Masked phone number (e.g., "91******10")
 */
export function maskPhoneNumber(phoneNumber: string): string {
  if (!phoneNumber || phoneNumber.length < 4) {
    return '****';
  }
  
  // For phone numbers, show first 2 and last 2 digits
  const visibleStart = 2;
  const visibleEnd = 2;
  const maskedLength = phoneNumber.length - visibleStart - visibleEnd;
  
  if (maskedLength <= 0) {
    return '****';
  }
  
  return phoneNumber.slice(0, visibleStart) + 
         '*'.repeat(Math.min(maskedLength, 6)) + 
         phoneNumber.slice(-visibleEnd);
}

/**
 * Correlation ID storage for tracking requests across async operations
 */
const correlationIdStore = new Map<string, string>();

/**
 * Generate a new correlation ID for request tracking
 * 
 * @returns UUID v4 correlation ID
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Set correlation ID for the current context
 * 
 * @param correlationId - Correlation ID to set
 */
export function setCorrelationId(correlationId: string): void {
  const asyncId = getAsyncId();
  correlationIdStore.set(asyncId, correlationId);
}

/**
 * Get correlation ID for the current context
 * 
 * @returns Current correlation ID or undefined
 */
export function getCorrelationId(): string | undefined {
  const asyncId = getAsyncId();
  return correlationIdStore.get(asyncId);
}

/**
 * Clear correlation ID for the current context
 */
export function clearCorrelationId(): void {
  const asyncId = getAsyncId();
  correlationIdStore.delete(asyncId);
}

/**
 * Get a simple async context identifier
 * In a real implementation, you might use AsyncLocalStorage
 */
function getAsyncId(): string {
  // Simple implementation using a global counter
  // In production, consider using AsyncLocalStorage from 'async_hooks'
  return 'global';
}

/**
 * Create a child logger with correlation ID
 * 
 * @param correlationId - Correlation ID for this logger instance
 * @returns Child logger with correlation ID in metadata
 */
export function createLoggerWithCorrelation(correlationId: string): winston.Logger {
  return logger.child({ correlationId });
}

/**
 * Log with automatic correlation ID from context
 * 
 * @param level - Log level
 * @param message - Log message
 * @param meta - Additional metadata
 */
export function logWithCorrelation(
  level: 'error' | 'warn' | 'info' | 'debug',
  message: string,
  meta?: Record<string, any>
): void {
  const correlationId = getCorrelationId();
  const logData = correlationId ? { ...meta, correlationId } : meta;
  logger.log(level, message, logData);
}

/**
 * Convenience methods for logging with correlation
 */
export const correlatedLogger = {
  error: (message: string, meta?: Record<string, any>) => 
    logWithCorrelation('error', message, meta),
  
  warn: (message: string, meta?: Record<string, any>) => 
    logWithCorrelation('warn', message, meta),
  
  info: (message: string, meta?: Record<string, any>) => 
    logWithCorrelation('info', message, meta),
  
  debug: (message: string, meta?: Record<string, any>) => 
    logWithCorrelation('debug', message, meta)
};

// Log initialization
logger.info('Logger initialized', {
  logLevel,
  nodeEnv,
  fileLogging: enableFileLogging,
  logFilePath: enableFileLogging ? logFilePath : 'disabled'
});
