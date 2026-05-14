FROM node:18-alpine

# Install Chromium for Puppeteer (required by whatsapp-web.js)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies to keep image small
RUN npm prune --production

# Create directories for session storage
RUN mkdir -p .wwebjs_auth .wwebjs_cache media/qr

# Render sets PORT env var automatically
# Health check server uses PORT, WhatsApp client runs independently
EXPOSE $PORT

# Start the bot
CMD ["node", "dist/index.js"]
