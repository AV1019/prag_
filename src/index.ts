/**
 * Entry point for Gyan WhatsApp Bot
 * Initializes whatsapp-web.js client and starts the bot service
 */

import dotenv from 'dotenv';
import express from 'express';
import { Message } from 'whatsapp-web.js';

// Load environment variables
dotenv.config();

import { SessionManager } from './client/SessionManager';
import { QRAuthenticator } from './client/QRAuthenticator';
import { MessageHandler } from './handlers/MessageHandler';
import { MessageRouter } from './handlers/MessageRouter';
import { MediaHandler } from './handlers/MediaHandler';
import { ContentGenerator } from './services/ContentGenerator';
import { ResponseFormatter } from './services/ResponseFormatter';
import { SpeechToText } from './services/SpeechToText';
import { RedisStore } from './storage/RedisStore';
import { SessionStore } from './storage/SessionStore';
import { logger } from './utils/logger';
import { metricsCollector } from './utils/metrics';
import { ConnectionState } from './types';

// ============================================================================
// Initialize components
// ============================================================================

const sessionManager = new SessionManager();
const qrAuthenticator = new QRAuthenticator();
const messageRouter = new MessageRouter();
const mediaHandler = new MediaHandler();
const contentGenerator = new ContentGenerator();
const responseFormatter = new ResponseFormatter();
const speechToText = new SpeechToText();

// Redis + Session store (will connect later)
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisStore = new RedisStore(redisUrl);
const sessionStore = new SessionStore(redisStore);

// Message handler (wired with all dependencies)
const messageHandler = new MessageHandler(
  messageRouter,
  mediaHandler,
  contentGenerator,
  responseFormatter,
  sessionStore,
  speechToText
);

// ============================================================================
// Express Health Check & QR Server
// ============================================================================

const app = express();
app.use(express.json());

// Render sets PORT automatically, use it for health check server
const REQUESTED_HEALTH_PORT = parseInt(process.env.PORT || process.env.HEALTH_CHECK_PORT || '3003', 10);
let healthPort = REQUESTED_HEALTH_PORT;

async function startHealthServer(preferredPort: number, maxRetries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number, retriesLeft: number): void => {
      const server = app.listen(port, () => {
        resolve(port);
      });

      server.once('error', (error: any) => {
        if (error?.code === 'EADDRINUSE' && retriesLeft > 0) {
          logger.warn(`Port ${port} is already in use, trying ${port + 1}...`);
          tryListen(port + 1, retriesLeft - 1);
          return;
        }

        reject(error);
      });
    };

    tryListen(preferredPort, maxRetries);
  });
}

// Health check endpoint
app.get('/health', (_req, res) => {
  const state = sessionManager.getConnectionState();
  res.json({
    status: state === ConnectionState.READY ? 'healthy' : 'unhealthy',
    whatsapp_connection: state,
    authenticated: sessionManager.isAuthenticated(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0',
  });
});

// QR code HTML page (user-friendly display)
app.get('/qr', (_req, res) => {
  const qrDataUrl = qrAuthenticator.getQRDataUrl();
  const state = sessionManager.getConnectionState();
  
  if (qrDataUrl) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Gyan WhatsApp Bot - QR Code</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              text-align: center;
              max-width: 600px;
            }
            h1 {
              color: #333;
              margin: 0 0 10px 0;
              font-size: 28px;
            }
            .subtitle {
              color: #666;
              margin-bottom: 30px;
              font-size: 16px;
            }
            .qr-container {
              background: #f5f5f5;
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
              display: inline-block;
            }
            img {
              max-width: 400px;
              width: 100%;
              height: auto;
            }
            .instructions {
              color: #666;
              margin-top: 30px;
              font-size: 14px;
              line-height: 1.6;
            }
            .status {
              margin-top: 20px;
              padding: 10px;
              background: #e8f5e9;
              border-left: 4px solid #4caf50;
              color: #2e7d32;
              border-radius: 4px;
              text-align: left;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 Gyan WhatsApp Bot</h1>
            <p class="subtitle">Scan QR Code to Connect</p>
            
            <div class="qr-container">
              <img src="${qrDataUrl}" alt="WhatsApp QR Code" />
            </div>
            
            <div class="instructions">
              <strong>How to connect:</strong>
              <ol>
                <li>Open WhatsApp on your phone</li>
                <li>Go to Settings → Linked Devices</li>
                <li>Click "Link a Device"</li>
                <li>Point your phone camera at the QR code above</li>
              </ol>
            </div>
            
            <div class="status">
              ✅ QR code is ready for scanning
            </div>
          </div>
        </body>
      </html>
    `);
  } else {
    const statusMessage = state === ConnectionState.READY
      ? 'Already connected'
      : 'QR code not yet generated, please wait...';
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Gyan WhatsApp Bot</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              text-align: center;
              max-width: 500px;
            }
            h1 { color: #333; margin: 0; }
            .status { 
              margin-top: 20px;
              padding: 15px;
              background: #fff3cd;
              border-left: 4px solid #ffc107;
              color: #856404;
              border-radius: 4px;
              font-size: 16px;
            }
            .spinner {
              margin: 20px 0;
              font-size: 40px;
              animation: spin 1s linear infinite;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 Gyan WhatsApp Bot</h1>
            <div class="spinner">⏳</div>
            <div class="status">${statusMessage}</div>
            <p style="color: #999; margin-top: 20px;">
              Please refresh this page in a few seconds...
            </p>
            <script>
              setTimeout(() => location.reload(), 3000);
            </script>
          </div>
        </body>
      </html>
    `);
  }
});

// QR code JSON API (for frontend integration)
app.get('/qr-json', (_req, res) => {
  const qrDataUrl = qrAuthenticator.getQRDataUrl();
  const state = sessionManager.getConnectionState();
  if (state === ConnectionState.READY) {
    res.json({ available: false, qr: null, message: 'Already connected' });
  } else if (qrDataUrl) {
    res.json({ available: true, qr: qrDataUrl });
  } else {
    res.json({ available: false, qr: null, message: 'QR code not yet generated' });
  }
});

// Bot status endpoint
app.get('/status', (_req, res) => {
  res.json({
    connection: sessionManager.getConnectionState(),
    authenticated: sessionManager.isAuthenticated(),
    metrics: metricsCollector.getMetricsSummary(),
  });
});

// Metrics endpoint (Prometheus format)
app.get('/metrics', (_req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(metricsCollector.exportPrometheusFormat());
});

// Send message endpoint (called by FastAPI backend) - requires API key
app.post('/send', async (req, res): Promise<void> => {
  // API Key authentication
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const expectedKey = process.env.INTERNAL_API_KEY;
  
  if (expectedKey && apiKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized - invalid API key' });
    return;
  }
  
  try {
    const { to, message, media_url, media_type } = req.body;
    const client = sessionManager.getClient();
    
    if (!client) {
      res.status(503).json({ error: 'WhatsApp client not ready' });
      return;
    }

    // Format the phone number for wwebjs: needs to be like 919876543210@c.us
    const chatId = to.includes('@') ? to : `${to.replace('+', '')}@c.us`;

    if (media_url) {
      if (media_type === 'video') {
        await mediaHandler.sendVideo(chatId, media_url, message || '');
      } else {
        await mediaHandler.sendImage(chatId, media_url, message || '');
      }
    } else {
      await client.sendMessage(chatId, message);
    }

    res.json({ success: true, to: chatId });
  } catch (error: any) {
    logger.error('Failed to send message via API', { error });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Main startup
// ============================================================================

async function main(): Promise<void> {
  logger.info('🚀 Gyan WhatsApp Bot — Starting...');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // 1. Connect to Redis (optional — works without it too)
  try {
    await redisStore.connect();
    logger.info('✅ Redis connected');
  } catch (error) {
    logger.warn('⚠️ Redis connection failed — running without session persistence', { error });
  }

  // 2. Set up QR authentication flow
  sessionManager.on('qr', async (qr: string) => {
    try {
      logger.debug('QR handler triggered', { qrLength: qr.length });
      await qrAuthenticator.generateQR(qr);
      qrAuthenticator.notifyQRReady(qr);
      logger.info('✅ QR code ready for scanning — visit http://localhost:' + healthPort + '/qr');
    } catch (error) {
      logger.error('Error handling QR code', { error: error instanceof Error ? error.message : String(error) });
    }
  });

  sessionManager.on('authenticated', () => {
    qrAuthenticator.handleAuthSuccess();
  });

  sessionManager.on('auth_failure', (msg: string) => {
    qrAuthenticator.handleAuthFailure(new Error(msg));
  });

  sessionManager.on('ready', () => {
    // Set the client on MediaHandler once ready
    const client = sessionManager.getClient();
    if (client) {
      mediaHandler.setClient(client);

      // Register message handler
      client.on('message', async (msg: Message) => {
        try {
          await messageHandler.handleMessage(msg);
        } catch (error) {
          logger.error('Unhandled error in message processing', { error });
        }
      });

      // Register poll-vote handler — fires when a user taps an option on
      // any poll we've sent (currently just quiz MCQs). Lets us grade
      // answers the instant the user votes, without waiting for them to
      // also type A/B/C/D. The handler itself is a safe no-op if no
      // pending quiz exists for the voter's session.
      client.on('vote_update', async (vote) => {
        try {
          await messageHandler.handlePollVote(vote);
        } catch (error) {
          logger.error('Unhandled error in poll vote processing', { error });
        }
      });
    }

    logger.info('🟢 WhatsApp Bot is READY and listening for messages!');
  });

  // 3. Start Express health check server
  healthPort = await startHealthServer(REQUESTED_HEALTH_PORT);
  logger.info(`📡 Health check server running on http://localhost:${healthPort}`);
  logger.info(`   QR code: http://localhost:${healthPort}/qr`);
  logger.info(`   Health:  http://localhost:${healthPort}/health`);
  logger.info(`   Status:  http://localhost:${healthPort}/status`);

  // 4. Initialize WhatsApp client (this triggers QR code generation)
  try {
    logger.info('Initializing WhatsApp Web client...');
    await sessionManager.initialize();
    logger.info('✅ WhatsApp client initialization complete');
  } catch (error: any) {
    logger.error('WhatsApp client initialization failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      errno: error?.errno,
      code: error?.code,
    });
    throw error;
  }
}

// ============================================================================
// Graceful shutdown
// ============================================================================

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  try {
    await sessionManager.destroy();
    await redisStore.disconnect();
  } catch (error) {
    logger.error('Error during shutdown', { error });
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  shutdown('uncaughtException');
});

// ============================================================================
// Keepalive mechanism (prevent Render free tier from spinning down)
// ============================================================================

function startKeepalive(port: number): void {
  // Self-ping every 10 minutes to keep the service alive on Render free tier
  const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  
  setInterval(async () => {
    try {
      const url = process.env.RENDER_EXTERNAL_URL 
        ? `https://${process.env.RENDER_EXTERNAL_URL}/health`
        : `http://localhost:${port}/health`;
      
      const response = await fetch(url);
      logger.debug('Keepalive ping sent', { status: response.status });
    } catch (error) {
      logger.debug('Keepalive ping failed (expected on startup)', { error });
    }
  }, KEEPALIVE_INTERVAL_MS);
  
  logger.info('🔄 Keepalive mechanism started (pinging every 10 minutes)');
}

// Start the bot
main().then(() => {
  // Start keepalive after successful startup
  startKeepalive(healthPort);
}).catch((error) => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  logger.error('Fatal error starting bot', {
    message: errorMsg,
    stack: errorStack,
  });
  process.exit(1);
});

export {};
