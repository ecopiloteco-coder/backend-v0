/**
 * PM2 Ecosystem Configuration
 * 
 * This file configures PM2 to manage your Node.js application in production.
 * PM2 provides:
 * - Auto-restart on crashes
 * - Keep-alive (prevents cold starts)
 * - Process monitoring
 * - Log management
 * - Zero-downtime reloads
 */

module.exports = {
  apps: [
    {
      name: 'ecopilot-backend',
      script: 'server/src/index.js',
      instances: 1, // Set to 'max' for cluster mode, or number for specific instances
      exec_mode: 'fork', // 'fork' for single instance, 'cluster' for multiple
      
      // Auto-restart configuration
      autorestart: true,
      watch: false, // Set to true for development, false for production
      max_memory_restart: '1G', // Restart if memory exceeds 1GB
      
      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      
      // Logging configuration
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true, // Prepend logs with timestamp
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true, // Merge logs from all instances
      
      // Advanced PM2 features
      min_uptime: '10s', // Minimum uptime before considering app stable
      max_restarts: 10, // Maximum restarts in 1 minute
      restart_delay: 4000, // Delay between restarts (ms)
      
      // Graceful shutdown
      kill_timeout: 5000, // Time to wait for graceful shutdown (ms)
      listen_timeout: 10000, // Time to wait for app to listen (ms)
      shutdown_with_message: true, // Send shutdown message to app
      
      // Health monitoring
      // PM2 will automatically restart if the process exits
      // For HTTP health checks, use the health endpoint in your app
      
      // Prevent cold starts - keep process alive
      // PM2 automatically keeps processes alive, but we can add a keep-alive ping
      // This is handled by PM2's autorestart feature
    }
  ]
};

