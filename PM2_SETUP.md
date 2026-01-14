# PM2 Setup Guide for Production

This guide explains how to use PM2 to keep your backend application alive in production and prevent cold starts.

## What is PM2?

PM2 is a production process manager for Node.js applications that provides:
- **Auto-restart on crashes** - Automatically restarts your app if it crashes
- **Keep-alive** - Prevents cold starts by keeping your app running
- **Process monitoring** - Monitors CPU, memory, and other metrics
- **Log management** - Centralized logging with rotation
- **Zero-downtime reloads** - Update your app without downtime

## Configuration

The PM2 configuration is in `ecosystem.config.js`. Key features:

- **Auto-restart**: Enabled by default
- **Memory limit**: Restarts if memory exceeds 1GB
- **Logging**: Logs are stored in `./logs/` directory
- **Graceful shutdown**: 5 second timeout for clean shutdowns

## Usage

### In Docker (Production)

PM2 is automatically used when you build and run the Docker container:

```bash
docker build -t ecopilot-backend .
docker run -p 5000:5000 ecopilot-backend
```

The Dockerfile uses `pm2-runtime` which is designed for containers and will:
- Keep your app alive
- Restart on crashes
- Handle graceful shutdowns
- Prevent cold starts

### Outside Docker (Direct Deployment)

If you're deploying directly to a server without Docker:

1. **Install PM2 globally** (optional, but recommended):
   ```bash
   npm install -g pm2
   ```

2. **Start the application**:
   ```bash
   npm run start:pm2:prod
   ```

3. **Useful PM2 commands**:
   ```bash
   # View logs
   npm run logs:pm2
   # Or: pm2 logs ecopilot-backend
   
   # Monitor processes
   npm run monit:pm2
   # Or: pm2 monit
   
   # Restart application
   npm run restart:pm2
   # Or: pm2 restart ecopilot-backend
   
   # Stop application
   npm run stop:pm2
   # Or: pm2 stop ecopilot-backend
   
   # View status
   pm2 status
   
   # Save PM2 configuration (survives reboots)
   pm2 save
   pm2 startup  # Generate startup script
   ```

4. **Enable PM2 on system startup**:
   ```bash
   pm2 save
   pm2 startup
   # Follow the instructions to enable PM2 on system boot
   ```

## Preventing Cold Starts

PM2 prevents cold starts by:
1. **Keeping the process alive** - The app stays running even when idle
2. **Auto-restart** - If the app crashes, PM2 immediately restarts it
3. **Health monitoring** - PM2 monitors the process and restarts if unhealthy

### Additional Keep-Alive Strategies

If you still experience cold starts (e.g., on free hosting platforms), you can:

1. **Add a keep-alive endpoint** that pings your app periodically:
   ```javascript
   // In your app.js or routes
   app.get('/keep-alive', (req, res) => {
     res.json({ status: 'alive', timestamp: new Date() });
   });
   ```

2. **Use a cron job or external service** to ping `/keep-alive` every 5-10 minutes:
   ```bash
   # Add to crontab (crontab -e)
   */5 * * * * curl -s https://your-app.com/keep-alive > /dev/null
   ```

3. **Use PM2's built-in HTTP ping** (if available in your PM2 version):
   ```javascript
   // In ecosystem.config.js
   pmx: {
     http: true
   }
   ```

## Monitoring

### View Logs
```bash
pm2 logs ecopilot-backend
# Or with tail
pm2 logs ecopilot-backend --lines 100
```

### Monitor Resources
```bash
pm2 monit
```

### View Process Info
```bash
pm2 show ecopilot-backend
```

## Troubleshooting

### App keeps restarting
- Check logs: `pm2 logs ecopilot-backend --err`
- Check memory usage: `pm2 monit`
- Review `max_memory_restart` in `ecosystem.config.js`

### Cold starts still happening
- Ensure PM2 is running: `pm2 status`
- Check if PM2 is set to start on boot: `pm2 startup`
- Consider using a keep-alive ping service
- Check your hosting provider's idle timeout settings

### Logs not appearing
- Ensure `logs/` directory exists and is writable
- Check file permissions
- Verify log paths in `ecosystem.config.js`

## Environment Variables

PM2 will use environment variables from:
1. `.env` file (loaded by dotenv)
2. Docker environment variables
3. System environment variables
4. `env_production` section in `ecosystem.config.js`

## Cluster Mode (Optional)

For better performance, you can enable cluster mode:

```javascript
// In ecosystem.config.js
instances: 'max', // Use all CPU cores
exec_mode: 'cluster', // Enable cluster mode
```

This will create multiple instances of your app, one per CPU core, for better performance and redundancy.

## Comparison with Uptime Robot

| Feature | PM2 | Uptime Robot |
|---------|-----|--------------|
| Keep-alive | ✅ Built-in | ❌ External service needed |
| Auto-restart | ✅ Yes | ❌ No |
| Process monitoring | ✅ Yes | ❌ No |
| Log management | ✅ Yes | ❌ No |
| Cost | ✅ Free | ⚠️ Free tier limited |
| Setup complexity | ✅ Simple | ⚠️ Requires external service |

PM2 is a better solution for keeping your app alive because it:
- Runs directly on your server
- Provides more control and monitoring
- Doesn't require external services
- Prevents cold starts more effectively

