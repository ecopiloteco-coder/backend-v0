# Backend Dockerfile
# Using node:20-slim instead of alpine to avoid DNS issues
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install build dependencies for native modules (bcrypt, argon2)
# Note: slim uses apt instead of apk
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/* 

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/

# Install dependencies (including PM2 for process management)
RUN npm ci --production

# Copy application code
COPY . .

# Create uploads and logs directories
RUN mkdir -p server/uploads && mkdir -p logs

# Expose port
EXPOSE 5000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# Start the server with PM2 for process management and keep-alive
# PM2 will automatically restart the app if it crashes and prevent cold starts
CMD ["npx", "pm2-runtime", "start", "ecosystem.config.js", "--env", "production"]

