# Gyan WhatsApp Bot

WhatsApp Web.js bot for Gyan_Intent EdTech platform. Provides educational content delivery through WhatsApp including video generation, concept explanations, and Q&A functionality.

## Features

- 🔐 WhatsApp Web authentication with QR code
- 📱 Message reception and routing
- 🎬 Video generation via LangGraph agents
- 📚 Concept explanations and Q&A
- 🌐 Hinglish language support
- 💾 Session persistence with Redis
- 📊 Monitoring and metrics
- 🔄 Automatic reconnection handling

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Redis server
- FastAPI backend (Gyan_Intent platform)

## Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Configuration

Edit `.env` file with your settings:

```bash
NODE_ENV=development
BACKEND_URL=http://localhost:8000
INTERNAL_API_KEY=your-api-key
REDIS_URL=redis://localhost:6379
```

## Development

```bash
# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run property-based tests only
npm run test:property

# Run integration tests only
npm run test:integration

# Run with coverage
npm run test:coverage

# Watch mode (for development)
npm run test:watch
```

## Project Structure

```
whatsapp-bot/
├── src/
│   ├── client/          # WhatsApp client management
│   ├── handlers/        # Message and media handlers
│   ├── services/        # Content generation and formatting
│   ├── storage/         # Redis and session storage
│   ├── utils/           # Logging and metrics
│   └── types/           # TypeScript type definitions
├── tests/
│   ├── unit/            # Unit tests
│   ├── property/        # Property-based tests
│   └── integration/     # Integration tests
└── dist/                # Compiled JavaScript (generated)
```

## Authentication

On first run, the bot will generate a QR code:
1. QR code will be displayed in the console
2. QR code image saved to `media/qr/latest.png`
3. Scan the QR code with WhatsApp on your phone
4. Session will be saved for automatic reconnection

## Architecture

The bot integrates with the existing Gyan_Intent platform:
- **FastAPI Backend**: Handles LangGraph agent orchestration
- **Redis**: Stores user sessions and connection state
- **LangGraph Agents**: Generate educational content
- **OpenAI**: Powers Q&A and explanations

## Monitoring

Health check endpoint available at:
```
http://localhost:3000/health
```

Returns connection status, uptime, and memory usage.

## License

MIT
