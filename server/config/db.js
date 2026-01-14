const path = require('path');
// Try to load from backend root .env (two levels up from config/)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Also try to load from current dir just in case, but don't override if already set
require('dotenv').config();

const { Pool } = require('pg');

// Create pool using DATABASE_URL or individual variables
const poolConfig = {
  max: 20, // Maximum number of connections
  idleTimeoutMillis: 0, // Disable idle timeout (connections never close due to inactivity)
  connectionTimeoutMillis: 10000, // Increase to 10 seconds to handle slow connections
  keepAlive: true, // Enable TCP keepalives
};

// Use DATABASE_URL if available, otherwise use individual variables
if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  poolConfig.ssl = { rejectUnauthorized: false }; // Often needed for hosted DBs like Neon/Supabase
} else {
  poolConfig.user = process.env.DB_USER;
  poolConfig.host = process.env.DB_HOST;
  poolConfig.database = process.env.DB_NAME;
  poolConfig.password = process.env.DB_PASSWORD;
  poolConfig.port = process.env.DB_PORT || 5432;
}

const pool = new Pool(poolConfig);

// Log connection events
pool.on('connect', () => {
  // console.log('New database connection established'); 
});

pool.on('remove', () => {
  console.log('Database connection closed');
});

// Handle unexpected errors and attempt to reconnect
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client:', err.message);
  // The pg Pool automatically attempts to reconnect, so no manual reconnect is needed
});

// Periodic keep-alive query to prevent connection timeouts
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return; // Already running
  
  keepAliveInterval = setInterval(async () => {
    // Only ping if we have active connections
    if (pool.totalCount > 0) {
      try {
        await pool.query('SELECT 1');
        // Only log in development or on failure
        if (process.env.NODE_ENV === 'development') {
          // console.log('Keep-alive query executed');
        }
      } catch (err) {
        console.error('Keep-alive query failed:', err.message);
      }
    }
  }, 60000); // Run every 1 minute
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Skip keep-alive in test environment to avoid noisy logs and timers
if (process.env.NODE_ENV !== 'test') {
  startKeepAlive();
}

// Validate environment variables (skip during tests)
if (process.env.NODE_ENV !== 'test') {
  if (process.env.DATABASE_URL) {
    console.log('✅ Using DATABASE_URL for connection');
  } else {
    const requiredEnvVars = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error(`❌ Missing environment variables: ${missingVars.join(', ')}`);
      console.error('Please provide either DATABASE_URL or all individual DB variables');
      // Don't exit process here, just warn, as this file might be imported in contexts where env vars are loaded differently
    } else {
      console.log('✅ Using individual DB variables for connection');
    }
  }
}

module.exports = pool;
module.exports.stopKeepAlive = stopKeepAlive;
