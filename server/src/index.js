// Load environment variables
// Try multiple paths for flexibility (Docker, local development, etc.)
const path = require('path');
const dotenvPaths = [
  path.resolve(process.cwd(), '.env'),           // Current directory
  path.resolve(__dirname, '../../.env'),          // Relative to index.js
  path.resolve(__dirname, '../../../.env'),       // Project root
];

// Load from the first existing .env file
for (const envPath of dotenvPaths) {
  const result = require('dotenv').config({ path: envPath });
  if (!result.error) {
    console.log(`✅ Loaded environment from: ${envPath}`);
    break;
  }
}

// Also load from environment (Docker passes env vars directly)
require('dotenv').config();

// Validate required environment variables before starting (non-blocking)
const { validateRequiredEnvVars } = require('./utils/validateEnv');
try {
  validateRequiredEnvVars();
  console.log('✅ Environment validation completed');
} catch (error) {
  console.warn('⚠️  Environment validation warning:', error.message);
  console.warn('Continuing to start server despite validation warnings...');
}

// Log JWT_SECRET status (without exposing the actual secret)
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'dev-insecure-secret') {
  console.warn('⚠️  WARNING: JWT_SECRET is not set - running in development mode');
  console.warn('   JWT tokens will be decoded without verification (INSECURE)');
  console.warn('   This should only be used for development/testing');
  console.warn('   For production, please set JWT_SECRET environment variable');
} else {
  console.log('✅ JWT_SECRET is configured - JWT verification enabled');
}

const pool = require('../config/db');
const app = require('./app');
const EventNotificationService = require('./services/EventNotificationService');
const FileWatcherService = require('./services/FileWatcherService');

// -------------------- Server --------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);

  // Start File Watcher
  try {
    // Watch the 'src' directory
    FileWatcherService.start(__dirname);
  } catch (err) {
    console.error('❌ Failed to start FileWatcherService:', err);
  }

  // Test DB connection without blocking the server
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Database connected successfully!');
    console.log('📅 Current time:', result.rows[0].current_time);
    console.log('🗄️ PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
    client.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.log('Continuing to run server without DB. Only non-DB routes will work.');
  }
  
  // Periodic cleanup of old events and notifications
  const retentionMinutes = parseInt(process.env.EVENT_RETENTION_MINUTES || String(60 * 24 * 60), 10);
  const cleanupIntervalMinutes = parseInt(process.env.EVENT_CLEANUP_INTERVAL_MINUTES || '1', 10);

  setInterval(() => {
    EventNotificationService.cleanupOldData(retentionMinutes).catch((err) => {
      console.error('❌ Error running events/notifications cleanup job:', err.message || err);
    });
  }, cleanupIntervalMinutes * 60 * 1000);

});

// -------------------- Graceful Shutdown --------------------
process.on('SIGTERM', async () => {
  console.log('Shutting down server...');
  
  // Stop File Watcher
  await FileWatcherService.stop();

  // Stop keep-alive interval
  if (pool.stopKeepAlive) {
    pool.stopKeepAlive();
  }
  
  // Close database pool
  await pool.end();
  console.log('Database pool closed.');
  process.exit(0);
});
