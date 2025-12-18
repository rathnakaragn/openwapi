# Use Node.js 20 Alpine base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create directories for data persistence
RUN mkdir -p /app/session /app/image

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/app/messages.db \
    SESSION_PATH=/app/session \
    MEDIA_PATH=/app/image

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/v1/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "app.js"]
